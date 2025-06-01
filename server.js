require("dotenv").config();
const environment = process.env.NODE_ENV ?? "production";
const express = require("express");
const { Telegraf } = require('telegraf');

if (!process.env.ERRORBOT_TOKEN) {
    throw new Error("ERRORBOT_TOKEN environment variable not set.");
}
if (!process.env.ERRORBOT_URL) {
    throw new Error("ERRORBOT_URL environment variable not set.");
}
if (!process.env.ERRORBOT_CHAT) {
    throw new Error("ERRORBOT_CHAT environment variable not set.");
}

const httpPort = 4000;
const botPort = 4001;

const token = process.env.ERRORBOT_TOKEN;
const url = process.env.ERRORBOT_URL;
const chat = process.env.ERRORBOT_CHAT;

const bot = new Telegraf(token);
const init = async () => {
  console.log('[Boot] Starting bot');
  bot.launch({ webhook: { domain: url, port: botPort } });
  console.log('[Boot] Bot ready on port ' + botPort);
}
init();


// html server
const app = express();
app.use(express.json());

app.post('/', (req, res) => {
  //Reply to the http request to close it
  res.send("OK");

  //Log everything to ourselves
  console.log(req.body);

  //Relay to admin chat
  bot.telegram.sendMessage(chat, JSON.stringify(req.body));
})

app.listen(httpPort, () => {
  console.log('[Boot] Listening for http on port ' + httpPort);
})

process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM shutdown');
  process.exit(1)
});
process.on('SIGINT', () => {
  console.log('[Shutdown] SIGINT shutdown');
  process.exit(1)
});