module.exports = function ({ api, models, Users, Threads, Currencies }) {
  const stringSimilarity = require('string-similarity');
  const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const logger = require("../../utils/log.js");
  const fs = require('fs');
  const path = require('path');
  const moment = require("moment-timezone");

  // --- CACHE for thread/user ---
  const threadCache = new Map();
  const userCache = new Map();

  async function getThreadInfo(threadID, Threads, threadInfo) {
    if (threadCache.has(threadID)) return threadCache.get(threadID);
    const info = threadInfo.get(threadID) || await Threads.getInfo(threadID);
    threadCache.set(threadID, info);
    return info;
  }

  async function getUserName(userID, Users) {
    if (userCache.has(userID)) return userCache.get(userID);
    const name = await Users.getNameUser(userID);
    userCache.set(userID, name);
    return name;
  }

  return async function ({ event }) {
    const dateNow = Date.now();
    const time = moment.tz("Asia/Kolkata").format("HH:mm:ss DD/MM/YYYY");

    const { allowInbox, PREFIX, ADMINBOT, NDH, DeveloperMode } = global.config;
    const { userBanned, threadBanned, threadInfo, threadData, commandBanned } = global.data;
    const { commands, cooldowns } = global.client;

    let { body, senderID, threadID, messageID } = event;
    body = body || "";
    senderID = String(senderID);
    threadID = String(threadID);

    let threadSettingBox = threadData.get(threadID) || {};
    let prefixbox = threadSettingBox.PREFIX || PREFIX;
    const prefixRegex = new RegExp(`^(<@!?${senderID}>|${escapeRegex(prefixbox)})\\s*`);

    // banned check
    if (userBanned.has(senderID) || threadBanned.has(threadID)) {
      if (!body.startsWith(PREFIX)) return;
      return api.sendMessage(`⚠️ You are banned from using this bot.`, threadID, messageID);
    }

    // args + command
    const [matchedPrefix] = body.match(prefixRegex) || [""];
    let args = body.slice(matchedPrefix.length).trim().split(/ +/);
    let commandName = args.shift()?.toLowerCase() || "";
    let command = commands.get(commandName);

    // unknown command handling (optimized)
    if (!command && body.startsWith(prefixbox)) {
      const allCommandName = Array.from(commands.keys());
      const checker = stringSimilarity.findBestMatch(commandName, allCommandName);
      if (checker.bestMatch.rating >= 0.5) {
        command = commands.get(checker.bestMatch.target);
      } else {
        return api.sendMessage(
          `❌ Command not found!\n💡 Try: ${prefixbox}menu\n👉 Similar: ${checker.bestMatch.target}`,
          threadID,
          messageID
        );
      }
    }

    if (!command) return;

    // get thread info + user info (cached)
    const threadInf = await getThreadInfo(threadID, Threads, threadInfo);
    const senderName = await getUserName(senderID, Users);

    // permissions
    let permssion = 0;
    const findAdmin = threadInf.adminIDs?.some(el => el.id == senderID);
    if (NDH.includes(senderID)) permssion = 3;
    else if (ADMINBOT.includes(senderID)) permssion = 2;
    else if (findAdmin) permssion = 1;

    if (command.config.hasPermssion > permssion) {
      return api.sendMessage(
        `👤 User: ${senderName}\n📝 Command: ${command.config.name} requires higher permission.`,
        threadID,
        messageID
      );
    }

    // cooldown check
    if (!cooldowns.has(command.config.name)) cooldowns.set(command.config.name, new Map());
    const timestamps = cooldowns.get(command.config.name);
    const expirationTime = (command.config.cooldowns || 1) * 1000;

    if (timestamps.has(senderID) && dateNow < timestamps.get(senderID) + expirationTime) {
      return api.sendMessage(
        `⏳ Please wait ${(timestamps.get(senderID) + expirationTime - dateNow) / 1000}s before using "${command.config.name}" again.`,
        threadID,
        messageID
      );
    }

    // run command
    try {
      command.run({ api, event, args, models, Users, Threads, Currencies, permssion });
      timestamps.set(senderID, dateNow);

      if (DeveloperMode) {
        logger(`Executed: ${commandName} by ${senderID} in ${threadID}`, "[ DEV MODE ]");
      }
    } catch (e) {
      return api.sendMessage(`❌ Error: ${e.message}`, threadID, messageID);
    }
  };
};
