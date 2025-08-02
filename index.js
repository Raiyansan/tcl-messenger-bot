// index.js
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const fs = require('fs');
const app = express();
app.use(bodyParser.json());

// Your chosen Verify Token (must match in FB webhook config)
const VERIFY_TOKEN = 'tcl_verify_2025';

// Your Page Access Token
const PAGE_ACCESS_TOKEN = 'EAAUswZBZCm9DQBPM3xlidwRkiX7ekF4sVZACeMwVG9kcA3FcT3T2K0I7jM0Huqm5wvH41lxrSj4lgZC7RJhjJa9LZBW3U84ryEP372rUws9S4yevZCtrb9ZBmI73c66e4nna1nQG3ADJDa2yq6d5bwRyIKBayLZCv5vYcNYZAXPyCq9CdBoJZCVZCZBDUYLjJ9vhFjtBJa0eXEz8XGRQCDot6gXR';

// Track user state
const userStates = {};

/** 1) Verification Endpoint */
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

/** 2) Message Handler */
app.post('/webhook', async (req, res) => {
  console.log('▶️ Incoming payload:', JSON.stringify(req.body, null, 2));
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      const event = entry.messaging[0];
      const psid = event.sender.id;

      // GET_STARTED
      if (event.postback && event.postback.payload === 'GET_STARTED') {
        userStates[psid] = null;
        await sendRoleMenu(psid);
      }
      // Quick replies
      else if (event.message && event.message.quick_reply) {
        const p = event.message.quick_reply.payload;
        console.log(`📩 Quick reply: ${p}`);
        switch (p) {
          case 'ROLE_STUDENT':
            userStates[psid] = null;
            await sendStudentMenu(psid);
            break;
          case 'STUDENT_FAQ':
            await sendStudentFAQMenu(psid);
            break;
          case 'FAQ_FEES':
            await sendFAQFees(psid);
            break;
          case 'FAQ_DEST':
            await sendFAQDest(psid);
            break;
          case 'FAQ_BRANCHES':
            await sendFAQBranches(psid);
            break;
          case 'STUDENT_COUNSELOR':
            userStates[psid] = 'AWAITING_COUNSELOR';
            await sendCounselorRequest(psid);
            break;
          case 'STUDY_PREF':
            userStates[psid] = 'AWAITING_PREF';
            await sendStudyPrefPrompt(psid);
            break;
          case 'ROLE_PARTNER':
            userStates[psid] = null;
            await sendPartnerInfo(psid);
            break;
          case 'ROLE_UNI':
            userStates[psid] = null;
            await sendUniversityInfo(psid);
            break;
          case 'MAIN_MENU':
          case 'RESTART':
            userStates[psid] = null;
            await sendRoleMenu(psid);
            break;
          default:
            await callSendAPI(psid, { text: 'Sorry, I didn’t understand that. Please choose an option.' });
        }
      }
      // Free-text
      else if (event.message && event.message.text) {
        const text = event.message.text.trim();
        const lower = text.toLowerCase();
        console.log(`📩 Text from ${psid}: ${text}`);

        if (['hi','hello','hey','start'].includes(lower)) {
          userStates[psid] = null;
          await sendRoleMenu(psid);
        }
        else if (userStates[psid] === 'AWAITING_COUNSELOR') {
          fs.appendFileSync('submissions.txt', `${psid}|counselor|${text}\n\n`);
          userStates[psid] = null;
          await sendAfterCounselorInfo(psid);
        }
        else if (userStates[psid] === 'AWAITING_PREF') {
          fs.appendFileSync('submissions.txt', `${psid}|preferences|${text}\n\n`);
          userStates[psid] = null;
          await sendAfterStudyPref(psid);
        }
        else {
          await callSendAPI(psid, { text: 'Thanks for your message! Use the menu below or type "hi" to start over.' });
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

/** Main Role Menu */
async function sendRoleMenu(psid) {
  await callSendAPI(psid, {
    text: "🎉 Welcome to TCL Global, a world-leading edtech agency with 20+ branches across 13+ countries! I'm Aithena, your AI assistant—how can I help you today?",
    quick_replies: [
      { content_type: 'text', title: 'Student',        payload: 'ROLE_STUDENT' },
      { content_type: 'text', title: 'Partner Agency', payload: 'ROLE_PARTNER' },
      { content_type: 'text', title: 'University',     payload: 'ROLE_UNI' }
    ]
  });
}

/** Student Home Menu */
async function sendStudentMenu(psid) {
  await callSendAPI(psid, {
    text:
`🌟 Hello future scholar! TCL Global empowers thousands of students worldwide.

You can explore on your own through our mobile app:
• Android: https://play.google.com/store/apps/details?id=com.ktpprod.tclglobalmobileapp
• Apple Store: https://apps.apple.com/gb/app/tcl-global/id6670448421?platform=iphone

What would you like to do next?`,
    quick_replies: [
      { content_type: 'text', title: 'FAQ',               payload: 'STUDENT_FAQ' },
      { content_type: 'text', title: 'Talk to counselor', payload: 'STUDENT_COUNSELOR' },
      { content_type: 'text', title: 'Main Menu',         payload: 'MAIN_MENU' }
    ]
  });
}

/** Student FAQ Menu */
async function sendStudentFAQMenu(psid) {
  await callSendAPI(psid, {
    text: "❓ Which FAQ can I answer for you?",
    quick_replies: [
      { content_type: 'text', title: 'Agency Fees',  payload: 'FAQ_FEES' },
      { content_type: 'text', title: 'Destinations', payload: 'FAQ_DEST' },
      { content_type: 'text', title: 'Our Branches', payload: 'FAQ_BRANCHES' },
      { content_type: 'text', title: 'Back',         payload: 'STUDENT_FAQ' }
    ]
  });
}

/** FAQ: Fees */
async function sendFAQFees(psid) {
  await callSendAPI(psid, {
    text:
`💰 We charge *no* agency fees, and most UK partner universities waive application charges.

Ready to apply? Download our app:
• Android: https://play.google.com/store/apps/details?id=com.ktpprod.tclglobalmobileapp
• Apple Store: https://apps.apple.com/gb/app/tcl-global/id6670448421?platform=iphone

Or chat with a counselor!`,
    quick_replies: [
      { content_type: 'text', title: 'Back to student menu', payload: 'ROLE_STUDENT' }
    ]
  });
}

/** FAQ: Destinations */
async function sendFAQDest(psid) {
  await callSendAPI(psid, {
    text:
`🌍 Our headquarters are in Portsmouth, UK, and we partner with leading universities across Canada, Australia, the USA & Europe. Your global education journey starts here!`,
    quick_replies: [
      { content_type: 'text', title: 'Back to student menu', payload: 'ROLE_STUDENT' }
    ]
  });
}

/** FAQ: Branches */
async function sendFAQBranches(psid) {
  await callSendAPI(psid, {
    text:
`📍 We have 20+ branches in 14+ countries. Find your nearest location here:
https://www.tclglobal.co.uk/branches`,
    quick_replies: [
      { content_type: 'text', title: 'Back to student menu', payload: 'ROLE_STUDENT' }
    ]
  });
}

/** Talk to Counselor */
async function sendCounselorRequest(psid) {
  await callSendAPI(psid, {
    text:
`👩‍💼 To connect you with a counselor, please send all your details in one message:
• Name (e.g. John Doe)
• Contact Number with country code (e.g. +44 7123 456789)
• Email Address (e.g. john@example.com)
• Closest City & Country (e.g. London, UK)`
  });
}

async function sendAfterCounselorInfo(psid) {
  await callSendAPI(psid, {
    text:
`Thank you! 🙏 Would you like to:
• Provide study preferences for a tailored match
• Return to the student menu`,
    quick_replies: [
      { content_type: 'text', title: 'Study preferences', payload: 'STUDY_PREF' },
      { content_type: 'text', title: 'Student menu',       payload: 'ROLE_STUDENT' }
    ]
  });
}

/** Study Preferences */
async function sendStudyPrefPrompt(psid) {
  await callSendAPI(psid, {
    text:
`📋 Please share your preferences in one message:
• Preferred destination country (e.g. UK)
• Planned intake year (e.g. 2026)
• Desired course (e.g. MSc Computer Science)
• Last degree & result (e.g. BSc CSE, CGPA 3.2/4)
• English test & score (e.g. IELTS 7)

Sample reply:
UK
2026
MSc Computer Science
BSc CSE, CGPA 3.2/4
IELTS 7`
  });
}

async function sendAfterStudyPref(psid) {
  await callSendAPI(psid, {
    text:
`Thanks for sharing! We'll match you with the best options. Return to the student menu?`,
    quick_replies: [
      { content_type: 'text', title: 'Student menu', payload: 'ROLE_STUDENT' }
    ]
  });
}

/** Partner Agency flow */
async function sendPartnerInfo(psid) {
  await callSendAPI(psid, {
    text:
`🤝 Thank you for partnering with TCL Global! Our agency team will reach out shortly.
For immediate follow-up:
✉️ partner@tclglobal.co.uk
📞 +44 7983 266707

Return to the main menu?`,
    quick_replies: [
      { content_type: 'text', title: 'Main Menu', payload: 'MAIN_MENU' }
    ]
  });
}

/** University flow */
async function sendUniversityInfo(psid) {
  await callSendAPI(psid, {
    text:
`🎓 Thanks for connecting! Our University Relations team will be in touch soon.
For urgent queries:
✉️ corporate@tclglobal.co.uk
📞 +44 7932 045457

Return to the main menu?`,
    quick_replies: [
      { content_type: 'text', title: 'Main Menu', payload: 'MAIN_MENU' }
    ]
  });
}

/** Helper to send via Send API */
async function callSendAPI(psid, message) {
  const body = { recipient: { id: psid }, message };
  await fetch(
    `https://graph.facebook.com/v16.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook listening on port ${PORT}`));
