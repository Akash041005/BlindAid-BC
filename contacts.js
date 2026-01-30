
const contacts = [
  { name: "Papa", phone: "+918008724249" },
  { name: "Friend", phone: "+916304037538" }
];

export async function notifyContacts({ userId, lat, lng, time }) {
  const msg =
    `🚨 SOS ALERT\n\n` +
    `User: ${userId}\n` +
    `⏰ ${time}\n\n` +
    `📍 Location:\n` +
    `https://maps.google.com/?q=${lat},${lng}\n\n` +
    `Please respond immediately.`;

  for (const c of contacts) {
    console.log(`📲 Sending to ${c.name} (${c.phone})`);
    console.log(msg);
  }
}
