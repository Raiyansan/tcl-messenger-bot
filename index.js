const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

// Verify token used in Facebook Webhook config
const VERIFY_TOKEN = 'tcl_verify_2025';

// Page tokens mapped by page ID
const PAGE_TOKENS = {
  '102616602614986': 'EAAUswZBZCm9DQBPM3xlidwRkiX7ekF4sVZACeMwVG9kcA3FcT3T2K0I7jM0Huqm5wvH41lxrSj4lgZC7RJhjJa9LZBW3U84ryEP372rUws9S4yevZCtrb9ZBmI73c66e4nna1nQG3ADJDa2yq6d5bwRyIKBayLZCv5vYcNYZAXPyCq9CdBoJZCVZCZBDUYLjJ9vhFjtBJa0eXEz8XGRQCDot6gXR', // Mongolia
  '100901415171135': 'EAAUswZBZCm9DQBPWKOpNSuJgiQTyZCPxjtiSXqZCi1UBRjWV1tPchmnu9kaaZBZAGcnofRgRqxl8mkI0sEarvwH9VyYQlbGd21ewQgQtcZA7Ef2iOtupoNwVlGKrzj35zgRcbk46NFlRgrqyBECcb1dtp3gcSQuPS9vaYXxpnERDHToSQZBu8ppBNqI5hbpAiIDMv4VH', // India
  '119924653251800': 'EAAUswZBZCm9DQBPXhGhimZAVl76VSfQsgNZB9A7Y5DvNNTv7QTfMXxRBWiCVhWyTI6Im1M0TFqykMoIZC8Yy2RX5wntofGHKdojqdaG7XfFRxVAe5EPXfZAZC24ZBETdu9jJ0IdxDxjyIuiQ5ldLCrpgq16xc359qwNZCAZAmWEJVDsJYzwAE0JgM1Ebbk9QjQMqrzpuD3', // Pakistan
  '102101415212896': 'EAAUswZBZCm9DQBPWE0zMoHvx68QVkY339BDZCHZAU7ZAKwl5DvZCyc7LT093RtjVXC5qp7y70iO1X27nOHjR2dlGZBlrqWxvDhBLWu7U872O8mwVeFdGJZCh8NRJmltxEbVBVmet4o9Xm0vgpr8UF63p4rOygJofaspwxarXoOKb01JcEsM0QNwfEZA1ENhZCCNThcAXkn'  // Bangladesh
};

// ===== CRM API (TEST) =====
const CRM_URL = 'https://main-service-iyy5u6jjmq-el.a.run.app/students/facebookquickadd';

// Small in-memory session store: psid -> { email, studentId, ts }
const sessionStore = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function upsertSession(psid, patch) {
  const prev = sessionStore.get(psid) || {};
  sessionStore.set(psid, { ...prev, ...patch, ts: Date.now() });
}

function pruneSessions() {
  const now = Date.now();
  for (const [psid, v] of sessionStore.entries()) {
    if (!v.ts || now - v.ts > SESSION_TTL_MS) sessionStore.delete(psid);
  }
}
// Prune occasionally
setInterval(pruneSessions, 60 * 60 * 1000); // hourly

// Helpers to extract contact details from a free-text message (best effort)
function extractEmail(text) {
  const m = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return m ? m[0].trim() : null;
}
function extractPhone(text) {
  // simple international-ish match
  const m = text.match(/(\+?\d[\d\s\-().]{6,}\d)/);
  return m ? m[0].replace(/[^\d+]/g, '').trim() : null;
}
function extractName(text, email, phone) {
  // Use first non-empty line that isn't clearly an email/phone
  const lines = text.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    const isEmail = email && line.includes(email);
    const isPhone = phone && line.replace(/[^\d+]/g, '') === phone;
    if (!isEmail && !isPhone) return line;
  }
  return 'Unknown';
}

// Call CRM to create/update student
async function crmCreateOrUpdateStudent({ fullname, email, phoneNumber }) {
  const payload = { fullname, email, phoneNumber };
  console.log('📤 CRM create/update payload:', payload);

  try {
    const res = await fetch(CRM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Most likely JSON, but guard for text
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    console.log('📥 CRM create/update response:', data);
    return data;
  } catch (err) {
    console.error('❌ CRM create/update error:', err);
    return null;
  }
}

// Call CRM to add a note using email + notes
async function crmAddNoteByEmail(email, notes) {
  const payload = { email, notes };
  console.log('📤 CRM add-note payload:', payload);

  try {
    const res = await fetch(CRM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    console.log('📥 CRM add-note response:', data);
    return data;
  } catch (err) {
    console.error('❌ CRM add-note error:', err);
    return null;
  }
}

// Track user state
const userStates = {};

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  console.log('▶️ Incoming payload:', JSON.stringify(req.body, null, 2));
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const pageId = entry.id;
      const token = PAGE_TOKENS[pageId];
      if (!token) continue;

      const event = entry.messaging[0];
      const psid = event.sender.id;

      // GET_STARTED
      if (event.postback && event.postback.payload === 'GET_STARTED') {
        userStates[psid] = null;
        await sendRoleMenu(psid, token);
      }

      // Quick replies
      else if (event.message && event.message.quick_reply) {
        const p = event.message.quick_reply.payload;
        switch (p) {
          case 'ROLE_STUDENT':
            userStates[psid] = null;
            await sendStudentMenu(psid, token);
            break;
          case 'STUDENT_FAQ':
            await sendStudentFAQMenu(psid, token);
            break;
          case 'FAQ_FEES':
            await sendFAQFees(psid, token);
            break;
          case 'FAQ_DEST':
            await sendFAQDest(psid, token);
            break;
          case 'FAQ_BRANCHES':
            await sendFAQBranches(psid, token);
            break;
          case 'STUDENT_COUNSELOR':
            userStates[psid] = 'AWAITING_COUNSELOR';
            await sendCounselorRequest(psid, token);
            break;
          case 'STUDY_PREF':
            userStates[psid] = 'AWAITING_PREF';
            await sendStudyPrefPrompt(psid, token);
            break;
          case 'ROLE_PARTNER':
            userStates[psid] = null;
            await sendPartnerInfo(psid, token);
            break;
          case 'ROLE_UNI':
            userStates[psid] = null;
            await sendUniversityInfo(psid, token);
            break;
          case 'MAIN_MENU':
          case 'RESTART':
            userStates[psid] = null;
            await sendRoleMenu(psid, token);
            break;
        }
      }

      // Free text
      else if (event.message && event.message.text) {
        const text = event.message.text.trim();
        const lower = text.toLowerCase();

        if (['hi', 'hello', 'hey', 'start'].includes(lower)) {
          userStates[psid] = null;
          await sendRoleMenu(psid, token);
        }
        else if (userStates[psid] === 'AWAITING_COUNSELOR') {
          // Keep your local file log
          fs.appendFileSync('submissions.txt', `${psid}|counselor|${text}\n\n`);

          // ===== CRM: create/update student =====
          try {
            const email = extractEmail(text);
            const phoneNumber = extractPhone(text);
            const fullname = extractName(text, email, phoneNumber);

            if (!email) {
              console.warn(`⚠️ No email found in counselor details from PSID ${psid}. CRM create skipped.`);
            } else {
              const crmRes = await crmCreateOrUpdateStudent({ fullname, email, phoneNumber });
              if (crmRes && crmRes.studentId) {
                upsertSession(psid, { email, studentId: crmRes.studentId });
                console.log(`✅ Stored session for PSID ${psid}:`, sessionStore.get(psid));
              } else if (email) {
                // Still keep email for follow-up notes even if studentId missing
                upsertSession(psid, { email });
              }
            }
          } catch (e) {
            console.error('❌ Error processing counselor info -> CRM:', e);
          }

          userStates[psid] = null;
          await sendAfterCounselorInfo(psid, token);
        }
        else if (userStates[psid] === 'AWAITING_PREF') {
          // Keep your local file log
          fs.appendFileSync('submissions.txt', `${psid}|preferences|${text}\n\n`);

          // ===== CRM: add note =====
          try {
            const sess = sessionStore.get(psid);
            let email = sess?.email || extractEmail(text);
            if (!email) {
              console.warn(`⚠️ No email available for PSID ${psid} when adding note. Note call skipped.`);
            } else {
              const crmRes = await crmAddNoteByEmail(email, text);
              console.log(`📝 Note add result for PSID ${psid}:`, crmRes);
            }
          } catch (e) {
            console.error('❌ Error adding study preference note -> CRM:', e);
          }

          userStates[psid] = null;
          await sendAfterStudyPref(psid, token);
        }
        else {
          await callSendAPI(psid, { text: 'Thanks for your message! Use the menu below or type "hi" to start over.' }, token);
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// ----- MESSAGING FUNCTIONS -----
const callSendAPI = async (psid, message, token) => {
  const body = {
    recipient: { id: psid },
    message
  };
  await fetch(`https://graph.facebook.com/v16.0/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
};

const sendRoleMenu = async (psid, token) => {
  await callSendAPI(psid, {
    text: "Hello! I'm Aithena, TCL's virtual assistant. 🤓 \n\nWelcome to TCL Global, a world-leading edtech agency with 20+ branches across 13+ countries and 60,000+ students guided so far! 🎉 \n\nPromise that I'll get you what you want in a just a few clicks! 😎 \n\nLet's get started! What's your role?",
    quick_replies: [
      { content_type: 'text', title: 'Student', payload: 'ROLE_STUDENT' },
      { content_type: 'text', title: 'Partner Agency', payload: 'ROLE_PARTNER' },
      { content_type: 'text', title: 'University', payload: 'ROLE_UNI' }
    ]
  }, token);
};

const sendStudentMenu = async (psid, token) => {
  await callSendAPI(psid, {
    text: `🌟 Hello future scholar! TCL Global empowers thousands of students worldwide!

👨‍🎓 Want to apply directly yourself? Use our mobile app to apply to over 100 global universities:

• Android: https://play.google.com/store/apps/details?id=com.ktpprod.tclglobalmobileapp
• Apple Store: https://apps.apple.com/gb/app/tcl-global/id6670448421?platform=iphone

Not sure yet? Have quick questions? 

Or want one of our expert counselors to guide you? Choose from below instead and I'll get you there!`,
    quick_replies: [
      { content_type: 'text', title: 'FAQ', payload: 'STUDENT_FAQ' },
      { content_type: 'text', title: 'Talk to counselor', payload: 'STUDENT_COUNSELOR' },
      { content_type: 'text', title: 'Main Menu', payload: 'MAIN_MENU' }
    ]
  }, token);
};

const sendStudentFAQMenu = async (psid, token) => {
  await callSendAPI(psid, {
    text: "Sure! Which question can I answer for you?",
    quick_replies: [
      { content_type: 'text', title: 'Agency Fees', payload: 'FAQ_FEES' },
      { content_type: 'text', title: 'Destinations', payload: 'FAQ_DEST' },
      { content_type: 'text', title: 'Our Branches', payload: 'FAQ_BRANCHES' },
      { content_type: 'text', title: 'Back', payload: 'ROLE_STUDENT' }
    ]
  }, token);
};

const sendFAQFees = async (psid, token) => {
  await callSendAPI(psid, {
    text: `💰 We charge *no* agency fees, and most UK partner universities waive application charges.

Ready to apply? Download our app:
• Android: https://play.google.com/store/apps/details?id=com.ktpprod.tclglobalmobileapp
• Apple Store: https://apps.apple.com/gb/app/tcl-global/id6670448421?platform=iphone

Or chat with a counselor!`,
    quick_replies: [{ content_type: 'text', title: 'Back to student menu', payload: 'ROLE_STUDENT' }]
  }, token);
};

const sendFAQDest = async (psid, token) => {
  await callSendAPI(psid, {
    text: `🌍 Our headquarters are in Portsmouth, UK, and we partner with leading universities across the UK, Canada, Australia, the USA & Europe. Your global education journey starts here!`,
    quick_replies: [{ content_type: 'text', title: 'Back to student menu', payload: 'ROLE_STUDENT' }]
  }, token);
};

const sendFAQBranches = async (psid, token) => {
  await callSendAPI(psid, {
    text: `📍 We have 20+ branches in 14+ countries. Find your nearest location here:
https://www.tclglobal.co.uk/branches`,
    quick_replies: [{ content_type: 'text', title: 'Back to student menu', payload: 'ROLE_STUDENT' }]
  }, token);
};

const sendCounselorRequest = async (psid, token) => {
  await callSendAPI(psid, {
    text: `👩‍💼Perfect, let me connect you to one of our expert counselors for personalized guidance. To guide you better, please send all your details in one message:

• Name
• Contact Number with country code
• Email Address
• Closest City & Country

Example reply (please follow this format!):

Your Name
+8801234567890
your_email@gmail.com
Dhaka, Bangladesh
`
  }, token);
};

const sendAfterCounselorInfo = async (psid, token) => {
  await callSendAPI(psid, {
    text: `Thank you! I'll pass this info to our counselors and they will call you back. 🙏 
    
We can serve you even better if you provide some more info. 

Would you like to:

• Provide study preferences for a tailored match
• Return to the student menu`,
    quick_replies: [
      { content_type: 'text', title: 'Study preferences', payload: 'STUDY_PREF' },
      { content_type: 'text', title: 'Student menu', payload: 'ROLE_STUDENT' }
    ]
  }, token);
};

const sendStudyPrefPrompt = async (psid, token) => {
  await callSendAPI(psid, {
    text: `Amazing! 📋 Please share your preferences in one message:

• Preferred destination country
• Planned intake year
• Desired course
• Last degree & result
• (optional) English test & score, if taken (e.g. IELTS 7)

Sample reply:
UK
2026
MSc Computer Science
BSc CSE, CGPA 3.2/4
IELTS 7`
  }, token);
};

const sendAfterStudyPref = async (psid, token) => {
  await callSendAPI(psid, {
    text: `Thanks for sharing! I'll pass these info to our counselors as well, so that they can guide you better. 

Return to the student menu?`,
    quick_replies: [{ content_type: 'text', title: 'Student menu', payload: 'ROLE_STUDENT' }]
  }, token);
};

const sendPartnerInfo = async (psid, token) => {
  await callSendAPI(psid, {
    text: `🤝 Thank you for your interest in partnering with TCL Global! Our agency team will reach out shortly.
If you need an immediate follow-up, please reach us at:
✉️ partner@tclglobal.co.uk or
📞 +44 7983 266707

Return to the main menu?`,
    quick_replies: [{ content_type: 'text', title: 'Main Menu', payload: 'MAIN_MENU' }]
  }, token);
};

const sendUniversityInfo = async (psid, token) => {
  await callSendAPI(psid, {
    text: `🎓 Thanks for connecting! Our University Relations team will be in touch soon.
If you need an immediate follow-up, please reach us at:
✉️ corporate@tclglobal.co.uk
📞 +44 7932 045457

Return to the main menu?`,
    quick_replies: [{ content_type: 'text', title: 'Main Menu', payload: 'MAIN_MENU' }]
  }, token);
};

// Launch the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook listening on port ${PORT}`));
