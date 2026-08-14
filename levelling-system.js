const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  AuditLogEvent,
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
} = require("@discordjs/voice");

const fs = require("node:fs");
const path = require("node:path");

/* =========================================================
   ENVIRONMENT
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

/* =========================================================
   SETTINGS
========================================================= */

const SPAM_MESSAGE_LIMIT = 3;
const SPAM_WINDOW_MS = 5000;

const FIRST_SPAM_TIMEOUT_MS = 5 * 60 * 1000;
const SECOND_SPAM_TIMEOUT_MS = 20 * 60 * 1000;

const SPAM_ACTION_DELAY_MS = 2000;

const COMMAND_COOLDOWN_MS = 2000;

const REP_VIEW_COOLDOWN_MS = 3000;
const GOODREP_COOLDOWN_MS = 5 * 60 * 1000;
const BADREP_COOLDOWN_MS = 7 * 60 * 1000;
const TOP_REP_COOLDOWN_MS = 5000;
const COMMENT_COOLDOWN_MS = 60 * 60 * 1000;

const DEFAULT_BAN_DURATION_MS =
  99 * 365 * 24 * 60 * 60 * 1000;

const MAX_TIMEOUT_MS =
  28 * 24 * 60 * 60 * 1000;

/* =========================================================
   DATA
========================================================= */

const DATA_DIR = path.join(__dirname, "data");

const LEVELS_FILE =
  path.join(DATA_DIR, "levels.json");

const ANNOUNCEMENTS_FILE =
  path.join(DATA_DIR, "announcements.json");

const SETTINGS_FILE =
  path.join(DATA_DIR, "settings.json");

const REPUTATION_FILE =
  path.join(DATA_DIR, "reputation.json");

const COMMENTS_FILE =
  path.join(DATA_DIR, "comments.json");

const WARNINGS_FILE =
  path.join(DATA_DIR, "warnings.json");

const MODERATION_FILE =
  path.join(DATA_DIR, "moderation.json");

const REWARDS_FILE =
  path.join(DATA_DIR, "levelRewards.json");

const SHORTCUTS_FILE =
  path.join(DATA_DIR, "shortcuts.json");

const LOGS_FILE =
  path.join(DATA_DIR, "logs.json");

fs.mkdirSync(DATA_DIR, {
  recursive: true,
});

/* =========================================================
   FILE HELPERS
========================================================= */

function load(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch (error) {
    console.error(
      `Failed to load ${file}:`,
      error
    );

    return fallback;
  }
}

function save(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error(
      `Failed to save ${file}:`,
      error
    );
  }
}

const levels =
  load(LEVELS_FILE, {});

const announcements =
  load(ANNOUNCEMENTS_FILE, {});

const settings =
  load(SETTINGS_FILE, {});

const reputation =
  load(REPUTATION_FILE, {});

const comments =
  load(COMMENTS_FILE, {});

const warnings =
  load(WARNINGS_FILE, {});

const moderation =
  load(MODERATION_FILE, {});

const levelRewards =
  load(REWARDS_FILE, {});

const shortcuts =
  load(SHORTCUTS_FILE, {});

const logs =
  load(LOGS_FILE, {});

function saveAll() {
  save(LEVELS_FILE, levels);
  save(ANNOUNCEMENTS_FILE, announcements);
  save(SETTINGS_FILE, settings);
  save(REPUTATION_FILE, reputation);
  save(COMMENTS_FILE, comments);
  save(WARNINGS_FILE, warnings);
  save(MODERATION_FILE, moderation);
  save(REWARDS_FILE, levelRewards);
  save(SHORTCUTS_FILE, shortcuts);
  save(LOGS_FILE, logs);
}

/* =========================================================
   GUILD SETTINGS
========================================================= */

function getGuildSettings(guildId) {
  if (!settings[guildId]) {
    settings[guildId] = {
      xpEnabled: false,
      xpChannels: {},

      spamEnabled: false,
      spamChannels: {},

      levelChannelId: null,
    };
  }

  if (
    typeof settings[guildId].xpChannels !==
    "object"
  ) {
    settings[guildId].xpChannels = {};
  }

  if (
    typeof settings[guildId].spamChannels !==
    "object"
  ) {
    settings[guildId].spamChannels = {};
  }

  return settings[guildId];
}

/* =========================================================
   XP
========================================================= */

function getUser(guildId, userId) {
  if (!levels[guildId]) {
    levels[guildId] = {};
  }

  if (!levels[guildId][userId]) {
    levels[guildId][userId] = {
      xp: 0,
      level: 0,
      messages: 0,
    };
  }

  return levels[guildId][userId];
}

function xpForLevel(level) {
  return Math.floor(
    100 * Math.pow(level, 1.5)
  );
}

function calculateLevel(xp) {
  let level = 0;

  while (
    xp >= xpForLevel(level + 1)
  ) {
    level++;
  }

  return level;
}

function progressBar(
  current,
  needed,
  size = 12
) {
  if (needed <= 0) {
    return "████████████";
  }

  const percentage =
    Math.max(
      0,
      Math.min(
        1,
        current / needed
      )
    );

  const filled =
    Math.floor(
      percentage * size
    );

  return (
    "█".repeat(filled) +
    "░".repeat(
      size - filled
    )
  );
}

function getRank(
  guildId,
  userId
) {
  const users =
    Object.entries(
      levels[guildId] || {}
    );

  users.sort(
    (a, b) =>
      b[1].xp - a[1].xp
  );

  const index =
    users.findIndex(
      ([id]) =>
        id === userId
    );

  return index === -1
    ? users.length + 1
    : index + 1;
}

function getTopXP(guildId) {
  return Object.entries(
    levels[guildId] || {}
  )
    .sort(
      (a, b) =>
        b[1].xp - a[1].xp
    )
    .slice(0, 100);
}

/* =========================================================
   XP ENABLE CHECK
========================================================= */

function isXPEnabled(
  guildSettings,
  channelId
) {
  if (
    guildSettings.xpChannels &&
    Object.prototype.hasOwnProperty.call(
      guildSettings.xpChannels,
      channelId
    )
  ) {
    return (
      guildSettings.xpChannels[channelId] ===
      true
    );
  }

  return guildSettings.xpEnabled === true;
}

/* =========================================================
   REPUTATION
========================================================= */

function getGuildReputation(
  guildId
) {
  if (!reputation[guildId]) {
    reputation[guildId] = {};
  }

  return reputation[guildId];
}

function getRep(
  guildId,
  userId
) {
  const guildRep =
    getGuildReputation(
      guildId
    );

  if (
    typeof guildRep[userId] !==
    "number"
  ) {
    guildRep[userId] = 0;
  }

  return guildRep[userId];
}

function changeRep(
  guildId,
  userId,
  amount
) {
  const guildRep =
    getGuildReputation(
      guildId
    );

  if (
    typeof guildRep[userId] !==
    "number"
  ) {
    guildRep[userId] = 0;
  }

  guildRep[userId] += amount;

  saveAll();

  return guildRep[userId];
}

function getTopRep(guildId) {
  return Object.entries(
    getGuildReputation(guildId)
  )
    .sort(
      (a, b) =>
        Number(b[1]) -
        Number(a[1])
    )
    .slice(0, 100);
}

/* =========================================================
   COMMENTS
========================================================= */

function getGuildComments(
  guildId
) {
  if (!comments[guildId]) {
    comments[guildId] = {};
  }

  return comments[guildId];
}

function getUserComments(
  guildId,
  userId
) {
  const guildComments =
    getGuildComments(
      guildId
    );

  if (!guildComments[userId]) {
    guildComments[userId] = [];
  }

  return guildComments[userId];
}

/* =========================================================
   WARNINGS
========================================================= */

function getGuildWarnings(
  guildId
) {
  if (!warnings[guildId]) {
    warnings[guildId] = {};
  }

  return warnings[guildId];
}

function getUserWarnings(
  guildId,
  userId
) {
  const guildWarnings =
    getGuildWarnings(
      guildId
    );

  if (!guildWarnings[userId]) {
    guildWarnings[userId] = [];
  }

  return guildWarnings[userId];
}

/* =========================================================
   LEVEL REWARDS
========================================================= */

function getGuildRewards(
  guildId
) {
  if (!levelRewards[guildId]) {
    levelRewards[guildId] = {};
  }

  return levelRewards[guildId];
}

/* =========================================================
   MODERATION DATA
========================================================= */

function getGuildModeration(
  guildId
) {
  if (!moderation[guildId]) {
    moderation[guildId] = {
      bans: {},
    };
  }

  if (!moderation[guildId].bans) {
    moderation[guildId].bans = {};
  }

  return moderation[guildId];
}

/* =========================================================
   SHORTCUTS
========================================================= */

function getGuildShortcuts(
  guildId
) {
  if (!shortcuts[guildId]) {
    shortcuts[guildId] = {};
  }

  return shortcuts[guildId];
}

/* =========================================================
   LOG SETTINGS
========================================================= */

function getGuildLogs(
  guildId
) {
  if (!logs[guildId]) {
    logs[guildId] = {
      enabled: false,
      categoryId: null,
      channels: {
        bans: null,
        timeouts: null,
        channels: null,
        messages: null,
        warns: null,
      },
    };
  }

  if (!logs[guildId].channels) {
    logs[guildId].channels = {
      bans: null,
      timeouts: null,
      channels: null,
      messages: null,
      warns: null,
    };
  }

  return logs[guildId];
}

/* =========================================================
   COOLDOWNS
========================================================= */

const commandCooldowns =
  new Map();

const repViewCooldowns =
  new Map();

const goodRepCooldowns =
  new Map();

const badRepCooldowns =
  new Map();

const topRepCooldowns =
  new Map();

const commentCooldowns =
  new Map();

function cooldownRemaining(
  map,
  key,
  duration
) {
  const last =
    map.get(key) || 0;

  const remaining =
    duration -
    (Date.now() - last);

  if (remaining > 0) {
    return remaining;
  }

  map.set(
    key,
    Date.now()
  );

  return 0;
}

/* =========================================================
   SPAM
========================================================= */

const spamTracker =
  new Map();

const spamActionLock =
  new Map();

const spamStrikes =
  new Map();

function getSpamKey(
  guildId,
  userId
) {
  return `${guildId}:${userId}`;
}

function isModerator(member) {
  if (!member) {
    return false;
  }

  return (
    member.permissions.has(
      PermissionFlagsBits.ModerateMembers
    ) ||
    member.permissions.has(
      PermissionFlagsBits.ManageGuild
    ) ||
    member.permissions.has(
      PermissionFlagsBits.KickMembers
    ) ||
    member.permissions.has(
      PermissionFlagsBits.BanMembers
    ) ||
    member.permissions.has(
      PermissionFlagsBits.Administrator
    )
  );
}

function clearSpamTracker(key) {
  spamTracker.delete(key);
}

function isSpamLocked(key) {
  const lock =
    spamActionLock.get(key);

  if (!lock) {
    return false;
  }

  if (Date.now() >= lock) {
    spamActionLock.delete(key);
    return false;
  }

  return true;
}

function registerSpamMessage(
  guildId,
  userId
) {
  const key =
    getSpamKey(
      guildId,
      userId
    );

  const now =
    Date.now();

  let timestamps =
    spamTracker.get(key) ||
    [];

  timestamps =
    timestamps.filter(
      (timestamp) =>
        now - timestamp <=
        SPAM_WINDOW_MS
    );

  timestamps.push(now);

  spamTracker.set(
    key,
    timestamps
  );

  return timestamps.length;
}

/* =========================================================
   SPAM CHANNEL CHECK
========================================================= */

function isSpamEnabled(
  guildSettings,
  channelId
) {
  if (
    guildSettings.spamChannels &&
    Object.prototype.hasOwnProperty.call(
      guildSettings.spamChannels,
      channelId
    )
  ) {
    return (
      guildSettings.spamChannels[channelId] ===
      true
    );
  }

  return guildSettings.spamEnabled === true;
}

/* =========================================================
   HANDLE SPAM
========================================================= */

async function handleSpam(
  message
) {
  if (!message.guild) {
    return false;
  }

  if (!message.member) {
    return false;
  }

  const guildSettings =
    getGuildSettings(
      message.guild.id
    );

  if (
    !isSpamEnabled(
      guildSettings,
      message.channel.id
    )
  ) {
    return false;
  }

  if (
    isModerator(
      message.member
    )
  ) {
    return false;
  }

  const key =
    getSpamKey(
      message.guild.id,
      message.author.id
    );

  const count =
    registerSpamMessage(
      message.guild.id,
      message.author.id
    );

  /*
    أكثر من 3 رسائل خلال أقل من 5 ثواني
    = 4 رسائل أو أكثر داخل النافذة.
  */

  if (
    count <=
    SPAM_MESSAGE_LIMIT
  ) {
    return false;
  }

  if (
    isSpamLocked(key)
  ) {
    return true;
  }

  spamActionLock.set(
    key,
    Date.now() +
      SPAM_ACTION_DELAY_MS
  );

  clearSpamTracker(key);

  const previousStrike =
    spamStrikes.get(key) ||
    0;

  const isSecondSpam =
    previousStrike >= 1;

  const timeoutDuration =
    isSecondSpam
      ? SECOND_SPAM_TIMEOUT_MS
      : FIRST_SPAM_TIMEOUT_MS;

  spamStrikes.set(
    key,
    previousStrike + 1
  );

  setTimeout(
    () => {
      const current =
        spamStrikes.get(key);

      if (
        current ===
        previousStrike + 1
      ) {
        spamStrikes.delete(key);
      }
    },
    30 * 60 * 1000
  );

  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        SPAM_ACTION_DELAY_MS
      )
  );

  const member =
    await message.guild.members
      .fetch(
        message.author.id
      )
      .catch(
        () => null
      );

  if (!member) {
    return true;
  }

  if (
    isModerator(member)
  ) {
    return true;
  }

  const botMember =
    message.guild.members.me;

  if (
    !botMember ||
    !botMember.permissions.has(
      PermissionFlagsBits.ModerateMembers
    )
  ) {
    console.error(
      "Bot does not have Moderate Members permission."
    );

    return true;
  }

  const reason =
    isSecondSpam
      ? "Spam protection - repeated spam"
      : "Spam protection";

  await member
    .timeout(
      timeoutDuration,
      reason
    )
    .catch(
      (error) => {
        console.error(
          "Failed to timeout spammer:",
          error
        );
      }
    );

  if (isSecondSpam) {
    await message.channel
      .send(
        "again? hope you enjoy the 20 min!"
      )
      .catch(
        () => {}
      );
  } else {
    await message.channel
      .send(
        "oops! seems like you send a lot of messages in a short time👀"
      )
      .catch(
        () => {}
      );
  }

  return true;
}

/* =========================================================
   DURATION PARSER
========================================================= */

function parseDuration(
  input,
  fallback
) {
  if (!input) {
    return fallback;
  }

  const text =
    String(input)
      .trim()
      .toLowerCase();

  if (
    text === "permanent" ||
    text === "perm"
  ) {
    return null;
  }

  const match =
    text.match(
      /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|yr|yrs|year|years)$/
    );

  if (!match) {
    return fallback;
  }

  const value =
    Number(match[1]);

  const unit =
    match[2];

  const units = {
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,

    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,

    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,

    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,

    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,

    mo: 30 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000,

    y: 365 * 24 * 60 * 60 * 1000,
    yr: 365 * 24 * 60 * 60 * 1000,
    yrs: 365 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
    years: 365 * 24 * 60 * 60 * 1000,
  };

  return (
    value * units[unit]
  );
}

function formatDuration(
  ms
) {
  if (ms === null) {
    return "Permanent";
  }

  if (!ms) {
    return "Unknown";
  }

  const seconds =
    Math.floor(ms / 1000);

  const days =
    Math.floor(
      seconds / 86400
    );

  const hours =
    Math.floor(
      (seconds % 86400) /
        3600
    );

  const minutes =
    Math.floor(
      (seconds % 3600) /
        60
    );

  const remainingSeconds =
    seconds % 60;

  const parts = [];

  if (days) {
    parts.push(
      `${days}d`
    );
  }

  if (hours) {
    parts.push(
      `${hours}h`
    );
  }

  if (minutes) {
    parts.push(
      `${minutes}m`
    );
  }

  if (
    remainingSeconds &&
    parts.length < 2
  ) {
    parts.push(
      `${remainingSeconds}s`
    );
  }

  return (
    parts.join(" ") ||
    "0s"
  );
}

/* =========================================================
   LOG HELPERS
========================================================= */

async function getLogChannel(
  guildId,
  type
) {
  const config =
    getGuildLogs(guildId);

  if (
    !config.enabled
  ) {
    return null;
  }

  const channelId =
    config.channels[type];

  if (!channelId) {
    return null;
  }

  return (
    client.channels.cache.get(
      channelId
    ) || null
  );
}

async function sendLog(
  guildId,
  type,
  embed
) {
  const channel =
    await getLogChannel(
      guildId,
      type
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return;
  }

  await channel
    .send({
      embeds: [embed],
    })
    .catch(
      () => {}
    );
}

function mentionUser(
  userId
) {
  return `<@${userId}>`;
}

function timestampNow() {
  return `<t:${Math.floor(
    Date.now() / 1000
  )}:F>`;
}

/* =========================================================
   AUDIT LOG STAFF
========================================================= */

async function findAuditEntry(
  guild,
  type,
  targetId
) {
  try {
    const audit =
      await guild.fetchAuditLogs({
        type,
        limit: 10,
      });

    const entry =
      audit.entries.find(
        (item) =>
          item.target?.id ===
            targetId &&
          Date.now() -
            item.createdTimestamp <
            15000
      );

    return entry || null;
  } catch {
    return null;
  }
}

/* =========================================================
   AUTO LOGS CREATION
========================================================= */

async function setupAutoLogs(
  guild
) {
  const existing =
    getGuildLogs(
      guild.id
    );

  let category =
    existing.categoryId
      ? guild.channels.cache.get(
          existing.categoryId
        )
      : null;

  if (
    !category ||
    category.type !==
      ChannelType.GuildCategory
  ) {
    category =
      await guild.channels
        .create({
          name: "LOGS",
          type:
            ChannelType.GuildCategory,
        })
        .catch(
          () => null
        );

    if (!category) {
      return false;
    }
  }

  const channelDefinitions = [
    {
      key: "bans",
      name: "bans - kicks",
    },
    {
      key: "timeouts",
      name: "timeouts",
    },
    {
      key: "channels",
      name: "channels - categories",
    },
    {
      key: "messages",
      name: "messages",
    },
    {
      key: "warns",
      name: "warns",
    },
  ];

  const result = {
    enabled: true,
    categoryId:
      category.id,
    channels: {},
  };

  for (
    const definition of
      channelDefinitions
  ) {
    let channel =
      existing.channels[
        definition.key
      ]
        ? guild.channels.cache.get(
            existing.channels[
              definition.key
            ]
          )
        : null;

    if (
      !channel ||
      channel.type !==
        ChannelType.GuildText
    ) {
      channel =
        await guild.channels
          .create({
            name:
              definition.name,
            type:
              ChannelType.GuildText,
            parent:
              category.id,
          })
          .catch(
            () => null
          );
    }

    if (channel) {
      result.channels[
        definition.key
      ] = channel.id;
    } else {
      result.channels[
        definition.key
      ] = null;
    }
  }

  logs[guild.id] =
    result;

  saveAll();

  return true;
}

/* =========================================================
   LEVEL REWARD CHECK
========================================================= */

async function checkLevelRewards(
  guild,
  member,
  oldLevel,
  newLevel
) {
  const rewards =
    getGuildRewards(
      guild.id
    );

  for (
    let level =
      oldLevel + 1;
    level <= newLevel;
    level++
  ) {
    const roleId =
      rewards[String(level)];

    if (!roleId) {
      continue;
    }

    const role =
      guild.roles.cache.get(
        roleId
      );

    if (!role) {
      continue;
    }

    if (
      member.roles.cache.has(
        role.id
      )
    ) {
      continue;
    }

    const botMember =
      guild.members.me;

    if (
      !botMember ||
      !botMember.permissions.has(
        PermissionFlagsBits.ManageRoles
      )
    ) {
      continue;
    }

    if (
      role.position >=
      botMember.roles.highest
        .position
    ) {
      continue;
    }

    await member.roles
      .add(
        role,
        `Level ${level} reward`
      )
      .catch(
        () => {}
      );
  }
}

/* =========================================================
   ANNOUNCEMENT BUILDER
========================================================= */

async function buildAnnouncement(
  guildId,
  type,
  page = 0
) {
  const top =
    getTopXP(guildId);

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        top.length / 10
      )
    );

  const safePage =
    Math.max(
      0,
      Math.min(
        page,
        totalPages - 1
      )
    );

  const start =
    safePage * 10;

  const pageUsers =
    top.slice(
      start,
      start + 10
    );

  const title =
    type === "daily"
      ? "daily announcement"
      : "weekly announcement";

  const rows = [];

  for (
    let i = 0;
    i < pageUsers.length;
    i++
  ) {
    const [
      userId,
      user,
    ] =
      pageUsers[i];

    const guild =
      client.guilds.cache.get(
        guildId
      );

    const member =
      await guild?.members
        .fetch(userId)
        .catch(
          () => null
        );

    const name =
      member?.displayName ||
      member?.user?.username ||
      `User ${userId}`;

    rows.push(
      `**#${start + i + 1}** ${name} • Level **${user.level}** • **${Number(user.xp).toFixed(2)} XP**`
    );
  }

  const embed =
    new EmbedBuilder()
      .setColor(
        0x00d4ff
      )
      .setTitle(title)
      .setDescription(
        `**Top 100 members with most XP**\n\n` +
          (
            rows.length
              ? rows.join("\n")
              : "No XP data yet."
          )
      )
      .setFooter({
        text:
          `Page ${safePage + 1}/${totalPages}`,
      });

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `xp_prev_${guildId}_${type}`
          )
          .setLabel(
            "Previous"
          )
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(
            safePage === 0
          ),

        new ButtonBuilder()
          .setCustomId(
            `xp_next_${guildId}_${type}`
          )
          .setLabel(
            "Next"
          )
          .setStyle(
            ButtonStyle.Primary
          )
          .setDisabled(
            safePage >=
              totalPages - 1
          )
      );

  return {
    embeds: [
      embed,
    ],
    components: [
      row,
    ],
  };
}

/* =========================================================
   SEND ANNOUNCEMENT
========================================================= */

async function sendAnnouncement(
  type
) {
  for (
    const [
      guildId,
      config,
    ] of Object.entries(
      announcements
    )
  ) {
    if (
      config.type !== type
    ) {
      continue;
    }

    if (
      !config.channelId
    ) {
      continue;
    }

    const guild =
      client.guilds.cache.get(
        guildId
      );

    if (!guild) {
      continue;
    }

    const channel =
      guild.channels.cache.get(
        config.channelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      continue;
    }

    const announcement =
      await buildAnnouncement(
        guildId,
        type,
        0
      );

    await channel
      .send(announcement)
      .catch(
        () => {}
      );
  }
}

/* =========================================================
   VAFK
========================================================= */

const vafkState =
  new Map();

async function startVAFK(
  guild,
  channel
) {
  if (
    channel.type !==
    ChannelType.GuildVoice
  ) {
    return false;
  }

  const existing =
    getVoiceConnection(
      guild.id
    );

  if (existing) {
    existing.destroy();
  }

  try {
    const connection =
      joinVoiceChannel({
        channelId:
          channel.id,
        guildId:
          guild.id,
        adapterCreator:
          guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
      });

    vafkState.set(
      guild.id,
      {
        channelId:
          channel.id,
        active: true,
      }
    );

    connection.on(
      "error",
      (error) => {
        console.error(
          "VAFK voice error:",
          error
        );
      }
    );

    /*
      IMPORTANT:

      If the bot gets kicked from voice,
      it does NOT automatically reconnect.

      It only joins again when /vafk is
      used manually.
    */

    return true;
  } catch (error) {
    console.error(
      "Failed to join VAFK:",
      error
    );

    return false;
  }
}

/* =========================================================
   BAN EXPIRATION
========================================================= */

async function processExpiredBans() {
  const now =
    Date.now();

  for (
    const [
      guildId,
      data,
    ] of Object.entries(
      moderation
    )
  ) {
    if (!data?.bans) {
      continue;
    }

    const guild =
      client.guilds.cache.get(
        guildId
      );

    if (!guild) {
      continue;
    }

    for (
      const [
        userId,
        ban,
      ] of Object.entries(
        data.bans
      )
    ) {
      if (
        !ban.expiresAt
      ) {
        continue;
      }

      if (
        now <
        ban.expiresAt
      ) {
        continue;
      }

      await guild.members
        .unban(
          userId,
          "Temporary ban expired"
        )
        .catch(
          () => {}
        );

      delete data.bans[
        userId
      ];

      saveAll();
    }
  }
}

setInterval(
  processExpiredBans,
  60_000
);

/* =========================================================
   COMMAND BUILDERS
========================================================= */

function buildCommands() {
  const commandList = [
    new SlashCommandBuilder()
      .setName("level")
      .setDescription(
        "Show your level and XP"
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member to check"
            )
            .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("top")
      .setDescription(
        "Show the top 100 XP members"
      ),

    new SlashCommandBuilder()
      .setName("top-xp")
      .setDescription(
        "Show the top 100 members by XP"
      ),

    new SlashCommandBuilder()
      .setName("xp-annc")
      .setDescription(
        "Configure daily or weekly XP announcements"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .addStringOption(
        (option) =>
          option
            .setName("type")
            .setDescription(
              "Announcement type"
            )
            .setRequired(true)
            .addChoices(
              {
                name: "Daily",
                value: "daily",
              },
              {
                name: "Weekly",
                value: "weekly",
              },
              {
                name: "Off",
                value: "off",
              }
            )
      )
      .addChannelOption(
        (option) =>
          option
            .setName("channel")
            .setDescription(
              "Announcement channel"
            )
            .setRequired(false)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
      ),

    new SlashCommandBuilder()
      .setName("xp-statue")
      .setDescription(
        "Turn XP on/off globally or for one channel"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .addStringOption(
        (option) =>
          option
            .setName("mode")
            .setDescription(
              "XP status"
            )
            .setRequired(true)
            .addChoices(
              {
                name: "On",
                value: "on",
              },
              {
                name: "Off",
                value: "off",
              }
            )
      )
      .addChannelOption(
        (option) =>
          option
            .setName("channel")
            .setDescription(
              "Optional channel"
            )
            .setRequired(false)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
      ),

    new SlashCommandBuilder()
      .setName("antispam-statue")
      .setDescription(
        "Turn anti-spam on/off globally or for one channel"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .addStringOption(
        (option) =>
          option
            .setName("mode")
            .setDescription(
              "Anti-spam status"
            )
            .setRequired(true)
            .addChoices(
              {
                name: "On",
                value: "on",
              },
              {
                name: "Off",
                value: "off",
              }
            )
      )
      .addChannelOption(
        (option) =>
          option
            .setName("channel")
            .setDescription(
              "Optional channel"
            )
            .setRequired(false)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
      ),

    new SlashCommandBuilder()
      .setName("level-channel")
      .setDescription(
        "Set level-up announcement channel"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .addStringOption(
        (option) =>
          option
            .setName("mode")
            .setDescription(
              "Set or disable"
            )
            .setRequired(true)
            .addChoices(
              {
                name: "Set",
                value: "set",
              },
              {
                name: "Off",
                value: "off",
              }
            )
      )
      .addChannelOption(
        (option) =>
          option
            .setName("channel")
            .setDescription(
              "Level channel"
            )
            .setRequired(false)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
      ),

    new SlashCommandBuilder()
      .setName("vafk")
      .setDescription(
        "Join the selected voice channel and stay AFK"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .addChannelOption(
        (option) =>
          option
            .setName("channel")
            .setDescription(
              "Voice channel"
            )
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildVoice
            )
      ),

    new SlashCommandBuilder()
      .setName("levelling-reward")
      .setDescription(
        "Give a role when a member reaches a level"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .addIntegerOption(
        (option) =>
          option
            .setName("level")
            .setDescription(
              "Required level"
            )
            .setRequired(true)
            .setMinValue(1)
      )
      .addRoleOption(
        (option) =>
          option
            .setName("role")
            .setDescription(
              "Reward role"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("rep")
      .setDescription(
        "Show reputation"
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member to check"
            )
            .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("goodrep-add")
      .setDescription(
        "Give someone +1 reputation"
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("badrep-add")
      .setDescription(
        "Give someone -0.50 reputation"
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("top-rep")
      .setDescription(
        "Show the top 100 reputation members"
      ),

    new SlashCommandBuilder()
      .setName("comment")
      .setDescription(
        "Send an anonymous impression to a member"
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      )
      .addStringOption(
        (option) =>
          option
            .setName("comment")
            .setDescription(
              "Your impression"
            )
            .setRequired(true)
            .setMaxLength(1000)
      ),

    new SlashCommandBuilder()
      .setName("view-comments")
      .setDescription(
        "View the impressions people left for you"
      )
      .addStringOption(
        (option) =>
          option
            .setName("hidden")
            .setDescription(
              "Should the response be hidden?"
            )
            .setRequired(false)
            .addChoices(
              {
                name: "Yes",
                value: "yes",
              },
              {
                name: "No",
                value: "no",
              }
            )
      ),

    new SlashCommandBuilder()
      .setName("auto-logs")
      .setDescription(
        "Create and enable the LOGS category and logging channels"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      ),

    new SlashCommandBuilder()
      .setName("warn")
      .setDescription(
        "Warn a member"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ModerateMembers
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      )
      .addStringOption(
        (option) =>
          option
            .setName("reason")
            .setDescription(
              "Reason"
            )
            .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription(
        "Timeout a member"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ModerateMembers
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      )
      .addStringOption(
        (option) =>
          option
            .setName("howmuch")
            .setDescription(
              "How long, e.g. 10m, 2h, 7d"
            )
            .setRequired(false)
      )
      .addStringOption(
        (option) =>
          option
            .setName("reason")
            .setDescription(
              "Reason"
            )
            .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("ban")
      .setDescription(
        "Ban a member"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.BanMembers
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      )
      .addStringOption(
        (option) =>
          option
            .setName("howmuch")
            .setDescription(
              "How long, e.g. 10m, 2h, 7d, 99y"
            )
            .setRequired(false)
      )
      .addStringOption(
        (option) =>
          option
            .setName("reason")
            .setDescription(
              "Reason"
            )
            .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("kick")
      .setDescription(
        "Kick a member"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.KickMembers
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      )
      .addStringOption(
        (option) =>
          option
            .setName("reason")
            .setDescription(
              "Reason"
            )
            .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("short")
      .setDescription(
        "Change a moderation command shortcut"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .addStringOption(
        (option) =>
          option
            .setName("command")
            .setDescription(
              "Command to give a shortcut"
            )
            .setRequired(true)
            .addChoices(
              {
                name: "Warn",
                value: "warn",
              },
              {
                name: "Timeout",
                value: "timeout",
              },
              {
                name: "Ban",
                value: "ban",
              },
              {
                name: "Kick",
                value: "kick",
              }
            )
      )
      .addStringOption(
        (option) =>
          option
            .setName("shortcut")
            .setDescription(
              "New shortcut"
            )
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(32)
      ),
  ];

  const guildShortcutCommands = [];

  for (
    const [
      guildId,
      data,
    ] of Object.entries(
      shortcuts
    )
  ) {
    if (!data) {
      continue;
    }

    for (
      const [
        original,
        shortcut,
      ] of Object.entries(data)
    ) {
      if (
        !shortcut ||
        shortcut === original ||
        !/^[a-z0-9_-]+$/.test(
          shortcut
        )
      ) {
        continue;
      }

      if (
        guildShortcutCommands.some(
          (command) =>
            command.name ===
            shortcut
        )
      ) {
        continue;
      }

      const command =
        createModerationCommand(
          shortcut,
          original
        );

      if (command) {
        guildShortcutCommands.push(
          command
        );
      }
    }
  }

  return [
    ...commandList,
    ...guildShortcutCommands,
  ].map(
    (command) =>
      command.toJSON()
  );
}

/* =========================================================
   MODERATION SHORTCUT COMMAND BUILDER
========================================================= */

function createModerationCommand(
  name,
  original
) {
  if (
    original === "warn"
  ) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        "Shortcut for warn"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ModerateMembers
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      )
      .addStringOption(
        (option) =>
          option
            .setName("reason")
            .setDescription(
              "Reason"
            )
            .setRequired(true)
      );
  }

  if (
    original === "timeout"
  ) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        "Shortcut for timeout"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ModerateMembers
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      )
      .addStringOption(
        (option) =>
          option
            .setName("howmuch")
            .setDescription(
              "How long"
            )
            .setRequired(false)
      )
      .addStringOption(
        (option) =>
          option
            .setName("reason")
            .setDescription(
              "Reason"
            )
            .setRequired(false)
      );
  }

  if (
    original === "ban"
  ) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        "Shortcut for ban"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.BanMembers
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      )
      .addStringOption(
        (option) =>
          option
            .setName("howmuch")
            .setDescription(
              "How long"
            )
            .setRequired(false)
      )
      .addStringOption(
        (option) =>
          option
            .setName("reason")
            .setDescription(
              "Reason"
            )
            .setRequired(false)
      );
  }

  if (
    original === "kick"
  ) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        "Shortcut for kick"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.KickMembers
      )
      .addUserOption(
        (option) =>
          option
            .setName("member")
            .setDescription(
              "Member"
            )
            .setRequired(true)
      )
      .addStringOption(
        (option) =>
          option
            .setName("reason")
            .setDescription(
              "Reason"
            )
            .setRequired(false)
      );
  }

  return null;
}

/* =========================================================
   CLIENT
========================================================= */

const client =
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
const gamesSystem = require("./games-system.js");
/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {
  const rest =
    new REST({
      version: "10",
    }).setToken(TOKEN);

  const commands =
    buildCommands();

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: commands,
      }
    );

    console.log(
      "Guild slash commands registered."
    );
  } else {
    await rest.put(
      Routes.applicationCommands(
        CLIENT_ID
      ),
      {
        body: commands,
      }
    );

    console.log(
      "Global slash commands registered."
    );
  }
}

/* =========================================================
   RE-REGISTER AFTER SHORTCUT CHANGE
========================================================= */

async function refreshCommands() {
  try {
    await registerCommands();
  } catch (error) {
    console.error(
      "Failed to refresh commands:",
      error
    );
  }
}

/* =========================================================
   READY
========================================================= */

client.once(
  Events.ClientReady,
  async (bot) => {
    console.log(
      `Logged in as ${bot.user.tag}`
    );

    try {
      await registerCommands();
    } catch (error) {
      console.error(
        "Failed to register commands:",
        error
      );
    }

    await processExpiredBans();
  }
);

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on(
  Events.MessageCreate,
  async (message) => {
    if (!message.guild) {
      return;
    }

    if (message.author.bot) {
      return;
    }

    if (!message.content) {
      return;
    }

    const wasSpam =
      await handleSpam(
        message
      );

    if (wasSpam) {
      return;
    }

    const guildSettings =
      getGuildSettings(
        message.guild.id
      );

    /*
      XP is OFF by default.
    */

    if (
      !isXPEnabled(
        guildSettings,
        message.channel.id
      )
    ) {
      return;
    }

    const words =
      message.content
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!words.length) {
      return;
    }

    const user =
      getUser(
        message.guild.id,
        message.author.id
      );

    const oldLevel =
      Number(user.level) || 0;

    let xpPerWord =
      Math.floor(
        Math.random() * 10
      ) + 1;

    if (
      Math.random() < 0.13
    ) {
      xpPerWord =
        Math.floor(
          Math.random() * 90
        ) + 11;
    }

    const earnedXP =
      words.length *
      xpPerWord;

    user.xp =
      Number(user.xp) +
      earnedXP;

    user.messages =
      Number(user.messages) + 1;

    const newLevel =
      calculateLevel(
        user.xp
      );

    user.level =
      newLevel;

    saveAll();

    if (
      newLevel <= oldLevel
    ) {
      return;
    }

    const member =
      message.member;

    await checkLevelRewards(
      message.guild,
      member,
      oldLevel,
      newLevel
    );

    const levelChannelId =
      guildSettings.levelChannelId;

    if (!levelChannelId) {
      return;
    }

    const levelChannel =
      message.guild.channels.cache.get(
        levelChannelId
      );

    if (
      !levelChannel ||
      !levelChannel.isTextBased()
    ) {
      return;
    }

    const currentLevelXP =
      xpForLevel(
        newLevel
      );

    const nextLevelXP =
      xpForLevel(
        newLevel + 1
      );

    const currentXP =
      Math.max(
        0,
        user.xp -
          currentLevelXP
      );

    const neededXP =
      Math.max(
        1,
        nextLevelXP -
          currentLevelXP
      );

    const embed =
      new EmbedBuilder()
        .setColor(
          0x81c1eb
        )
        .setTitle(
          "you have levelled up! keep it up for a cookie 🍪!"
        )
        .setDescription(
          `${message.author} reached **Level ${newLevel}**!`
        )
        .addFields(
          {
            name: "XP",
            value:
              `**${user.xp.toFixed(2)} XP**`,
            inline: true,
          },
          {
            name: "Progress",
            value:
              `${progressBar(
                currentXP,
                neededXP
              )}\n` +
              `${currentXP.toFixed(2)} / ${neededXP.toFixed(2)} XP`,
          }
        );

    await levelChannel
      .send({
        content:
          `${message.author}`,
        embeds: [
          embed,
        ],
      })
      .catch(
        () => {}
      );
  }
);

/* =========================================================
   MESSAGE DELETE LOG
========================================================= */

client.on(
  Events.MessageDelete,
  async (message) => {
    if (
      !message.guild ||
      message.author?.bot
    ) {
      return;
    }

    const content =
      message.content ||
      "Message content unavailable.";

    const embed =
      new EmbedBuilder()
        .setColor(
          0xff4d4d
        )
        .setTitle(
          "a message was deleted"
        )
        .addFields(
          {
            name: "message",
            value:
              content.slice(
                0,
                1024
              ),
          },
          {
            name: "sent by",
            value:
              message.author
                ? mentionUser(
                    message.author.id
                  )
                : "Unknown",
            inline: true,
          },
          {
            name: "in",
            value:
              message.channel
                ? `<#${message.channel.id}>`
                : "Unknown",
            inline: true,
          },
          {
            name: "time",
            value:
              timestampNow(),
          }
        );

    await sendLog(
      message.guild.id,
      "messages",
      embed
    );
  }
);

/* =========================================================
   MESSAGE EDIT LOG
========================================================= */

client.on(
  Events.MessageUpdate,
  async (
    oldMessage,
    newMessage
  ) => {
    if (
      !newMessage.guild ||
      newMessage.author?.bot
    ) {
      return;
    }

    if (
      oldMessage.content ===
      newMessage.content
    ) {
      return;
    }

    const before =
      oldMessage.content ||
      "Message content unavailable.";

    const after =
      newMessage.content ||
      "Message content unavailable.";

    const embed =
      new EmbedBuilder()
        .setColor(
          0xffc107
        )
        .setTitle(
          "a message was edited"
        )
        .addFields(
          {
            name:
              "message before edit",
            value:
              before.slice(
                0,
                1024
              ),
          },
          {
            name:
              "message after edit",
            value:
              after.slice(
                0,
                1024
              ),
          },
          {
            name: "sent by",
            value:
              mentionUser(
                newMessage.author.id
              ),
            inline: true,
          },
          {
            name: "in",
            value:
              `<#${newMessage.channel.id}>`,
            inline: true,
          },
          {
            name: "time",
            value:
              timestampNow(),
          }
        );

    await sendLog(
      newMessage.guild.id,
      "messages",
      embed
    );
  }
);

/* =========================================================
   BAN LOG
========================================================= */

client.on(
  Events.GuildBanAdd,
  async (ban) => {
    const entry =
      await findAuditEntry(
        ban.guild,
        AuditLogEvent.MemberBanAdd,
        ban.user.id
      );

    const staff =
      entry?.executor
        ? mentionUser(
            entry.executor.id
          )
        : "Unknown";

    const reason =
      entry?.reason ||
      "No reason provided";

    const embed =
      new EmbedBuilder()
        .setColor(
          0xff0000
        )
        .setTitle(
          "a member was banned"
        )
        .addFields(
          {
            name: "member",
            value:
              mentionUser(
                ban.user.id
              ),
          },
          {
            name: "staff",
            value: staff,
          },
          {
            name: "banned for",
            value:
              "Permanent / duration recorded by command",
          },
          {
            name: "reason",
            value:
              reason.slice(
                0,
                1024
              ),
          }
        )
        .setTimestamp();

    await sendLog(
      ban.guild.id,
      "bans",
      embed
    );
  }
);

/* =========================================================
   KICK LOG
========================================================= */

client.on(
  Events.GuildMemberRemove,
  async (member) => {
    const entry =
      await findAuditEntry(
        member.guild,
        AuditLogEvent.MemberKick,
        member.id
      );

    if (!entry) {
      return;
    }

    const staff =
      entry.executor
        ? mentionUser(
            entry.executor.id
          )
        : "Unknown";

    const reason =
      entry.reason ||
      "No reason provided";

    const embed =
      new EmbedBuilder()
        .setColor(
          0xff8800
        )
        .setTitle(
          "a member was kicked"
        )
        .addFields(
          {
            name: "member",
            value:
              mentionUser(
                member.id
              ),
          },
          {
            name: "staff",
            value: staff,
          },
          {
            name: "banned for",
            value:
              "Not applicable",
          },
          {
            name: "reason",
            value:
              reason.slice(
                0,
                1024
              ),
          }
        )
        .setTimestamp();

    await sendLog(
      member.guild.id,
      "bans",
      embed
    );
  }
);

/* =========================================================
   TIMEOUT LOG
========================================================= */

client.on(
  Events.GuildMemberUpdate,
  async (
    oldMember,
    newMember
  ) => {
    const oldTimeout =
      oldMember.communicationDisabledUntilTimestamp;

    const newTimeout =
      newMember.communicationDisabledUntilTimestamp;

    if (
      oldTimeout ===
      newTimeout
    ) {
      return;
    }

    if (
      !newTimeout ||
      newTimeout <=
        Date.now()
    ) {
      return;
    }

    const entry =
      await findAuditEntry(
        newMember.guild,
        AuditLogEvent.MemberUpdate,
        newMember.id
      );

    const staff =
      entry?.executor
        ? mentionUser(
            entry.executor.id
          )
        : "Unknown";

    const duration =
      newTimeout -
      Date.now();

    const embed =
      new EmbedBuilder()
        .setColor(
          0xffcc00
        )
        .setTitle(
          "a member have been timeouted"
        )
        .addFields(
          {
            name: "member",
            value:
              mentionUser(
                newMember.id
              ),
          },
          {
            name: "staff",
            value: staff,
          },
          {
            name: "timeouted for",
            value:
              formatDuration(
                duration
              ),
          }
        )
        .setTimestamp();

    await sendLog(
      newMember.guild.id,
      "timeouts",
      embed
    );
  }
);

/* =========================================================
   CHANNEL CREATE
========================================================= */

client.on(
  Events.ChannelCreate,
  async (channel) => {
    if (!channel.guild) {
      return;
    }

    const entry =
      await findAuditEntry(
        channel.guild,
        AuditLogEvent.ChannelCreate,
        channel.id
      );

    const staff =
      entry?.executor
        ? mentionUser(
            entry.executor.id
          )
        : "Unknown";

    const type =
      channel.type ===
      ChannelType.GuildCategory
        ? "category"
        : "channel";

    const name =
      channel.type ===
      ChannelType.GuildCategory
        ? channel.name
        : `<#${channel.id}>`;

    const embed =
      new EmbedBuilder()
        .setColor(
          0x00cc66
        )
        .setTitle(
          `a ${type} have been created`
        )
        .addFields(
          {
            name: "name",
            value: name,
          },
          {
            name:
              "was created by",
            value: staff,
          }
        )
        .setTimestamp();

    await sendLog(
      channel.guild.id,
      "channels",
      embed
    );
  }
);

/* =========================================================
   CHANNEL DELETE
========================================================= */

client.on(
  Events.ChannelDelete,
  async (channel) => {
    if (!channel.guild) {
      return;
    }

    const entry =
      await findAuditEntry(
        channel.guild,
        AuditLogEvent.ChannelDelete,
        channel.id
      );

    const staff =
      entry?.executor
        ? mentionUser(
            entry.executor.id
          )
        : "Unknown";

    const type =
      channel.type ===
      ChannelType.GuildCategory
        ? "category"
        : "channel";

    const name =
      channel.name ||
      "Unknown";

    const embed =
      new EmbedBuilder()
        .setColor(
          0xff3333
        )
        .setTitle(
          `a ${type} have been deleted`
        )
        .addFields(
          {
            name: "name",
            value:
              channel.type ===
              ChannelType.GuildCategory
                ? name
                : `#${name}`,
          },
          {
            name:
              "was deleted by",
            value: staff,
          }
        )
        .setTimestamp();

    await sendLog(
      channel.guild.id,
      "channels",
      embed
    );
  }
);

/* =========================================================
   CHANNEL UPDATE
========================================================= */

client.on(
  Events.ChannelUpdate,
  async (
    oldChannel,
    newChannel
  ) => {
    if (!newChannel.guild) {
      return;
    }

    const changes = [];

    if (
      oldChannel.name !==
      newChannel.name
    ) {
      changes.push(
        `previous name: **${oldChannel.name}**`
      );

      changes.push(
        `new name: **${newChannel.name}**`
      );
    }

    if (
      oldChannel.permissionOverwrites?.cache
        .map(
          (x) =>
            `${x.id}:${x.allow.bitfield}:${x.deny.bitfield}`
        )
        .join("|") !==
      newChannel.permissionOverwrites?.cache
        .map(
          (x) =>
            `${x.id}:${x.allow.bitfield}:${x.deny.bitfield}`
        )
        .join("|")
    ) {
      changes.push(
        "permissions were changed"
      );
    }

    if (!changes.length) {
      return;
    }

    const entry =
      await findAuditEntry(
        newChannel.guild,
        AuditLogEvent.ChannelUpdate,
        newChannel.id
      );

    const staff =
      entry?.executor
        ? mentionUser(
            entry.executor.id
          )
        : "Unknown";

    const embed =
      new EmbedBuilder()
        .setColor(
          0xffc107
        )
        .setTitle(
          "a channel have been edited"
        )
        .addFields(
          {
            name: "name",
            value:
              `<#${newChannel.id}>`,
          },
          {
            name:
              "was edited by",
            value: staff,
          },
          {
            name:
              "previous name/perms",
            value:
              changes
                .filter(
                  (x) =>
                    x.startsWith(
                      "previous"
                    ) ||
                    x.includes(
                      "permissions"
                    )
                )
                .join("\n")
                .slice(
                  0,
                  1024
                ) ||
              "No visible previous changes",
          },
          {
            name:
              "new perms/name",
            value:
              changes
                .filter(
                  (x) =>
                    x.startsWith(
                      "new"
                    ) ||
                    x.includes(
                      "permissions"
                    )
                )
                .join("\n")
                .slice(
                  0,
                  1024
                ) ||
              "No visible new changes",
          }
        )
        .setTimestamp();

    await sendLog(
      newChannel.guild.id,
      "channels",
      embed
    );
  }
);

/* =========================================================
   INTERACTIONS
========================================================= */

client.on(
  Events.InteractionCreate,
  async (interaction) => {
    if (!interaction.guild) {
      return;
    }

    /* =====================================================
       BUTTONS
    ===================================================== */

    if (
      interaction.isButton()
    ) {
      const parts =
        interaction.customId.split(
          "_"
        );

      if (
        parts[0] !== "xp"
      ) {
        return;
      }

      const direction =
        parts[1];

      const guildIdFromButton =
        parts[2];

      const type =
        parts[3];

      if (
        guildIdFromButton !==
        interaction.guild.id
      ) {
        return;
      }

      const footer =
        interaction.message
          .embeds[0]
          ?.footer
          ?.text || "";

      const pageMatch =
        footer.match(
          /Page (\d+)\/(\d+)/
        );

      const currentPage =
        pageMatch
          ? Number(
              pageMatch[1]
            ) - 1
          : 0;

      const totalPages =
        pageMatch
          ? Number(
              pageMatch[2]
            )
          : 1;

      let newPage =
        currentPage;

      if (
        direction ===
        "next"
      ) {
        newPage =
          Math.min(
            currentPage + 1,
            totalPages - 1
          );
      }

      if (
        direction ===
        "prev"
      ) {
        newPage =
          Math.max(
            currentPage - 1,
            0
          );
      }

      const updated =
        await buildAnnouncement(
          guildIdFromButton,
          type,
          newPage
        );

      await interaction
        .update(updated)
        .catch(
          () => {}
        );

      return;
    }

    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    /* =====================================================
       COMMAND COOLDOWN
    ===================================================== */

    const commandKey =
      `${interaction.guild.id}:${interaction.user.id}:${interaction.commandName}`;

    const commandRemaining =
      cooldownRemaining(
        commandCooldowns,
        commandKey,
        COMMAND_COOLDOWN_MS
      );

    if (
      commandRemaining > 0
    ) {
      await interaction
        .reply({
          content:
            `Please wait ${Math.ceil(
              commandRemaining /
                1000
            )} second(s) before using this command again.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    const guildId =
      interaction.guild.id;

    const guildSettings =
      getGuildSettings(
        guildId
      );

    const originalCommand =
      Object.entries(
        getGuildShortcuts(
          guildId
        )
      ).find(
        ([, shortcut]) =>
          shortcut ===
          interaction.commandName
      )?.[0] ||
      interaction.commandName;

    /* =====================================================
       /LEVEL
    ===================================================== */

    if (
      originalCommand ===
      "level"
    ) {
      const target =
        interaction.options.getUser(
          "member"
        ) ||
        interaction.user;

      const member =
        await interaction.guild.members
          .fetch(target.id)
          .catch(
            () => null
          );

      const displayName =
        member?.displayName ||
        target.username;

      const user =
        getUser(
          guildId,
          target.id
        );

      const rank =
        getRank(
          guildId,
          target.id
        );

      const currentLevelXP =
        xpForLevel(
          user.level
        );

      const nextLevelXP =
        xpForLevel(
          user.level + 1
        );

      const currentXP =
        Math.max(
          0,
          user.xp -
            currentLevelXP
        );

      const neededXP =
        Math.max(
          1,
          nextLevelXP -
            currentLevelXP
        );

      const embed =
        new EmbedBuilder()
          .setColor(
            0x00d4ff
          )
          .setAuthor({
            name:
              `${displayName}'s information`,
            iconURL:
              target.displayAvatarURL(),
          })
          .setDescription(
            `**Level ${user.level}**\n` +
              `Rank **#${rank}**\n\n` +
              `${progressBar(
                currentXP,
                neededXP
              )}\n` +
              `${currentXP.toFixed(2)} / ${neededXP.toFixed(2)} XP`
          )
          .addFields(
            {
              name: "XP",
              value:
                `**${Number(user.xp).toFixed(2)}**`,
              inline: true,
            },
            {
              name: "Level",
              value:
                `**${user.level}**`,
              inline: true,
            },
            {
              name: "Messages",
              value:
                `**${Number(user.messages).toLocaleString()}**`,
              inline: true,
            },
            {
              name: "Server",
              value:
                interaction.guild.name,
            }
          )
          .setThumbnail(
            target.displayAvatarURL()
          )
          .setFooter({
            text:
              "Keep it up to claim higher ranks and get more cookies! 🍪",
          });

      await interaction
        .reply({
          embeds: [
            embed,
          ],
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /TOP / /TOP-XP
    ===================================================== */

    if (
      originalCommand ===
        "top" ||
      originalCommand ===
        "top-xp"
    ) {
      const announcement =
        await buildAnnouncement(
          guildId,
          "daily",
          0
        );

      await interaction
        .reply(announcement)
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /XP-ANNC
    ===================================================== */

    if (
      originalCommand ===
      "xp-annc"
    ) {
      const type =
        interaction.options.getString(
          "type",
          true
        );

      const channel =
        interaction.options.getChannel(
          "channel"
        );

      if (
        type === "off"
      ) {
        delete announcements[
          guildId
        ];

        saveAll();

        await interaction
          .reply({
            content:
              "XP announcements are now disabled.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      if (
        !channel ||
        !channel.isTextBased()
      ) {
        await interaction
          .reply({
            content:
              "Please select a text channel.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      announcements[
        guildId
      ] = {
        type,
        channelId:
          channel.id,
      };

      saveAll();

      await interaction
        .reply({
          content:
            `${type === "daily" ? "Daily" : "Weekly"} XP announcements are now enabled in ${channel}.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /XP-STATUE
    ===================================================== */

    if (
      originalCommand ===
      "xp-statue"
    ) {
      const mode =
        interaction.options.getString(
          "mode",
          true
        );

      const channel =
        interaction.options.getChannel(
          "channel"
        );

      /*
        No channel:
        turn the whole XP system off.

        Channel:
        specifically enable/disable that channel.
      */

      if (!channel) {
        guildSettings.xpEnabled =
          false;

        guildSettings.xpChannels =
          {};

        saveAll();

        await interaction
          .reply({
            content:
              "XP system is now completely OFF.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      guildSettings.xpChannels[
        channel.id
      ] =
        mode === "on";

      saveAll();

      await interaction
        .reply({
          content:
            mode === "on"
              ? `XP is now ON in ${channel}.`
              : `XP is now OFF in ${channel}.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /ANTISPAM-STATUE
    ===================================================== */

    if (
      originalCommand ===
      "antispam-statue"
    ) {
      const mode =
        interaction.options.getString(
          "mode",
          true
        );

      const channel =
        interaction.options.getChannel(
          "channel"
        );

      if (!channel) {
        guildSettings.spamEnabled =
          false;

        guildSettings.spamChannels =
          {};

        for (
          const key of spamTracker.keys()
        ) {
          if (
            key.startsWith(
              `${guildId}:`
            )
          ) {
            spamTracker.delete(
              key
            );
          }
        }

        saveAll();

        await interaction
          .reply({
            content:
              "Anti-spam system is now completely OFF.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      guildSettings.spamChannels[
        channel.id
      ] =
        mode === "on";

      saveAll();

      await interaction
        .reply({
          content:
            mode === "on"
              ? `Anti-spam is now ON in ${channel}.`
              : `Anti-spam is now OFF in ${channel}.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /LEVEL-CHANNEL
    ===================================================== */

    if (
      originalCommand ===
      "level-channel"
    ) {
      const mode =
        interaction.options.getString(
          "mode",
          true
        );

      const channel =
        interaction.options.getChannel(
          "channel"
        );

      if (
        mode === "off"
      ) {
        guildSettings.levelChannelId =
          null;

        saveAll();

        await interaction
          .reply({
            content:
              "Level-up announcements are now disabled.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      if (
        !channel ||
        !channel.isTextBased()
      ) {
        await interaction
          .reply({
            content:
              "Please select a text channel.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      guildSettings.levelChannelId =
        channel.id;

      saveAll();

      await interaction
        .reply({
          content:
            `Level-up messages will now be sent in ${channel}.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /VAFK
    ===================================================== */

    if (
      originalCommand ===
      "vafk"
    ) {
      const channel =
        interaction.options.getChannel(
          "channel",
          true
        );

      const success =
        await startVAFK(
          interaction.guild,
          channel
        );

      if (!success) {
        await interaction
          .reply({
            content:
              "I couldn't join that voice channel.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      await interaction
        .reply({
          content:
            `Joined ${channel} and I'm now AFK there.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /LEVELLING-REWARD
    ===================================================== */

    if (
      originalCommand ===
      "levelling-reward"
    ) {
      const level =
        interaction.options.getInteger(
          "level",
          true
        );

      const role =
        interaction.options.getRole(
          "role",
          true
        );

      const botMember =
        interaction.guild.members.me;

      if (
        botMember &&
        role.position >=
          botMember.roles.highest
            .position
      ) {
        await interaction
          .reply({
            content:
              "I cannot give this role because it is higher than or equal to my highest role.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      getGuildRewards(
        guildId
      )[String(level)] =
        role.id;

      saveAll();

      await interaction
        .reply({
          content:
            `Level **${level}** is now configured to give ${role}.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /REP
    ===================================================== */

    if (
      originalCommand ===
      "rep"
    ) {
      const target =
        interaction.options.getUser(
          "member"
        ) ||
        interaction.user;

      const key =
        `${guildId}:${interaction.user.id}`;

      const remaining =
        cooldownRemaining(
          repViewCooldowns,
          key,
          REP_VIEW_COOLDOWN_MS
        );

      if (
        remaining > 0
      ) {
        await interaction
          .reply({
            content:
              `Please wait ${Math.ceil(
                remaining /
                  1000
              )} second(s).`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const value =
        getRep(
          guildId,
          target.id
        );

      await interaction
        .reply({
          content:
            `${target} has **${value.toFixed(2)} reputation**.`,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /GOODREP-ADD
    ===================================================== */

    if (
      originalCommand ===
      "goodrep-add"
    ) {
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      const key =
        `${guildId}:${interaction.user.id}`;

      const remaining =
        cooldownRemaining(
          goodRepCooldowns,
          key,
          GOODREP_COOLDOWN_MS
        );

      if (
        remaining > 0
      ) {
        await interaction
          .reply({
            content:
              `You can use this again in ${formatDuration(
                remaining
              )}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const newValue =
        changeRep(
          guildId,
          target.id,
          1
        );

      await interaction
        .reply({
          content:
            `You gave ${target} **+1 reputation**. Their reputation is now **${newValue.toFixed(2)}**.`,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /BADREP-ADD
    ===================================================== */

    if (
      originalCommand ===
      "badrep-add"
    ) {
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      const key =
        `${guildId}:${interaction.user.id}`;

      const remaining =
        cooldownRemaining(
          badRepCooldowns,
          key,
          BADREP_COOLDOWN_MS
        );

      if (
        remaining > 0
      ) {
        await interaction
          .reply({
            content:
              `You can use this again in ${formatDuration(
                remaining
              )}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const newValue =
        changeRep(
          guildId,
          target.id,
          -0.5
        );

      await interaction
        .reply({
          content:
            `You gave ${target} **-0.50 reputation**. Their reputation is now **${newValue.toFixed(2)}**.`,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /TOP-REP
    ===================================================== */

    if (
      originalCommand ===
      "top-rep"
    ) {
      const key =
        `${guildId}:${interaction.user.id}`;

      const remaining =
        cooldownRemaining(
          topRepCooldowns,
          key,
          TOP_REP_COOLDOWN_MS
        );

      if (
        remaining > 0
      ) {
        await interaction
          .reply({
            content:
              `Please wait ${Math.ceil(
                remaining /
                  1000
              )} second(s).`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const top =
        getTopRep(guildId);

      const rows = [];

      for (
        let i = 0;
        i < top.length;
        i++
      ) {
        const [
          userId,
          value,
        ] =
          top[i];

        const member =
          await interaction.guild.members
            .fetch(userId)
            .catch(
              () => null
            );

        const name =
          member?.displayName ||
          member?.user?.username ||
          `User ${userId}`;

        rows.push(
          `**#${i + 1}** ${name} • **${Number(value).toFixed(2)} rep**`
        );
      }

      const totalPages =
        Math.max(
          1,
          Math.ceil(
            rows.length /
              10
          )
        );

      const firstPage =
        rows.slice(
          0,
          10
        );

      const embed =
        new EmbedBuilder()
          .setColor(
            0x00d4ff
          )
          .setTitle(
            "top 100 reputation"
          )
          .setDescription(
            firstPage.length
              ? firstPage.join(
                  "\n"
                )
              : "No reputation data yet."
          )
          .setFooter({
            text:
              `Page 1/${totalPages}`,
          });

      await interaction
        .reply({
          embeds: [
            embed,
          ],
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /COMMENT
    ===================================================== */

    if (
      originalCommand ===
      "comment"
    ) {
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      const text =
        interaction.options.getString(
          "comment",
          true
        );

      const key =
        `${guildId}:${interaction.user.id}`;

      const remaining =
        cooldownRemaining(
          commentCooldowns,
          key,
          COMMENT_COOLDOWN_MS
        );

      if (
        remaining > 0
      ) {
        await interaction
          .reply({
            content:
              `You can send another impression in ${formatDuration(
                remaining
              )}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const userComments =
        getUserComments(
          guildId,
          target.id
        );

      userComments.push({
        id:
          `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`,
        text,
        createdAt:
          Date.now(),
        authorId:
          interaction.user.id,
      });

      saveAll();

      const embed =
        new EmbedBuilder()
          .setColor(
            0x81c1eb
          )
          .setTitle(
            "you received a new impression"
          )
          .setDescription(
            text
          )
          .setFooter({
            text:
              "The sender is anonymous.",
          })
          .setTimestamp();

      await target
        .send({
          embeds: [
            embed,
          ],
        })
        .catch(
          () => {}
        );

      await interaction
        .reply({
          content:
            "Your anonymous impression has been sent.",
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /VIEW-COMMENTS
    ===================================================== */

    if (
      originalCommand ===
      "view-comments"
    ) {
      const hidden =
        interaction.options.getString(
          "hidden"
        );

      const userComments =
        getUserComments(
          guildId,
          interaction.user.id
        );

      if (
        !userComments.length
      ) {
        await interaction
          .reply({
            content:
              "You don't have any comments yet.",
            ephemeral:
              hidden !== "no",
          })
          .catch(
            () => {}
          );

        return;
      }

      const rows =
        userComments
          .slice(-20)
          .map(
            (
              comment,
              index
            ) =>
              `**#${index + 1}** ${comment.text}`
          );

      const embed =
        new EmbedBuilder()
          .setColor(
            0x81c1eb
          )
          .setTitle(
            "your impressions"
          )
          .setDescription(
            rows.join("\n\n")
          )
          .setFooter({
            text:
              "All comments are anonymous.",
          });

      await interaction
        .reply({
          embeds: [
            embed,
          ],
          ephemeral:
            hidden !== "no",
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /AUTO-LOGS
    ===================================================== */

    if (
      originalCommand ===
      "auto-logs"
    ) {
      const success =
        await setupAutoLogs(
          interaction.guild
        );

      if (!success) {
        await interaction
          .reply({
            content:
              "I couldn't create the LOGS category/channels. Check my Manage Channels permission.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      await interaction
        .reply({
          content:
            "Auto-logs are now enabled. I created/updated the LOGS category and its 5 logging channels.",
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /WARN
    ===================================================== */

    if (
      originalCommand ===
      "warn"
    ) {
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      const reason =
        interaction.options.getString(
          "reason",
          true
        );

      const targetMember =
        await interaction.guild.members
          .fetch(target.id)
          .catch(
            () => null
          );

      if (
        !targetMember
      ) {
        await interaction
          .reply({
            content:
              "That member isn't in the server.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const userWarnings =
        getUserWarnings(
          guildId,
          target.id
        );

      userWarnings.push({
        reason,
        staffId:
          interaction.user.id,
        createdAt:
          Date.now(),
      });

      saveAll();

      const count =
        userWarnings.length;

      const embed =
        new EmbedBuilder()
          .setColor(
            0xffaa00
          )
          .setTitle(
            `${target.username} was warn!`
          )
          .addFields(
            {
              name: "reason",
              value:
                reason.slice(
                  0,
                  1024
                ),
            },
            {
              name:
                "who warned 'em",
              value:
                mentionUser(
                  interaction.user.id
                ),
            },
            {
              name:
                "how many warns they have now",
              value:
                String(count),
            },
            {
              name:
                "when did they warn 'em",
              value:
                timestampNow(),
            }
          )
          .setTimestamp();

      await sendLog(
        guildId,
        "warns",
        embed
      );

      await target
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0xffaa00
              )
              .setTitle(
                `You were warned in ${interaction.guild.name}`
              )
              .addFields(
                {
                  name: "Reason",
                  value:
                    reason.slice(
                      0,
                      1024
                    ),
                },
                {
                  name:
                    "Total warns",
                  value:
                    String(count),
                }
              )
              .setTimestamp(),
          ],
        })
        .catch(
          () => {}
        );

      await interaction
        .reply({
          content:
            `${target} has been warned. They now have **${count} warn(s)**.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /TIMEOUT
    ===================================================== */

    if (
      originalCommand ===
      "timeout"
    ) {
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      const howMuch =
        interaction.options.getString(
          "howmuch"
        );

      const reason =
        interaction.options.getString(
          "reason"
        ) ||
        "No reason provided";

      const targetMember =
        await interaction.guild.members
          .fetch(target.id)
          .catch(
            () => null
          );

      if (
        !targetMember
      ) {
        await interaction
          .reply({
            content:
              "That member isn't in the server.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      let duration =
        parseDuration(
          howMuch,
          MAX_TIMEOUT_MS
        );

      /*
        Discord maximum timeout:
        28 days.
      */

      if (
        duration === null ||
        duration >
          MAX_TIMEOUT_MS
      ) {
        duration =
          MAX_TIMEOUT_MS;
      }

      await targetMember
        .timeout(
          duration,
          reason
        )
        .catch(
          async () => {
            await interaction
              .reply({
                content:
                  "I couldn't timeout that member. Check my Moderate Members permission and role hierarchy.",
                ephemeral: true,
              })
              .catch(
                () => {}
              );
          }
        );

      const logEmbed =
        new EmbedBuilder()
          .setColor(
            0xffcc00
          )
          .setTitle(
            "a member have been timeouted"
          )
          .addFields(
            {
              name: "member",
              value:
                mentionUser(
                  target.id
                ),
            },
            {
              name: "staff",
              value:
                mentionUser(
                  interaction.user.id
                ),
            },
            {
              name:
                "timeouted for",
              value:
                formatDuration(
                  duration
                ),
            },
            {
              name: "reason",
              value:
                reason.slice(
                  0,
                  1024
                ),
            }
          )
          .setTimestamp();

      await sendLog(
        guildId,
        "timeouts",
        logEmbed
      );

      await interaction
        .reply({
          content:
            `${target} has been timeouted for **${formatDuration(
              duration
            )}**.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /BAN
    ===================================================== */

    if (
      originalCommand ===
      "ban"
    ) {
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      const howMuch =
        interaction.options.getString(
          "howmuch"
        );

      const reason =
        interaction.options.getString(
          "reason"
        ) ||
        "No reason provided";

      const duration =
        parseDuration(
          howMuch,
          DEFAULT_BAN_DURATION_MS
        );

      await interaction.guild.members
        .ban(
          target.id,
          {
            reason,
            deleteMessageSeconds:
              0,
          }
        )
        .catch(
          async () => {
            await interaction
              .reply({
                content:
                  "I couldn't ban that member. Check my Ban Members permission and role hierarchy.",
                ephemeral: true,
              })
              .catch(
                () => {}
              );
          }
        );

      const moderationData =
        getGuildModeration(
          guildId
        );

      if (
        duration !== null
      ) {
        moderationData.bans[
          target.id
        ] = {
          expiresAt:
            Date.now() +
            duration,
          staffId:
            interaction.user.id,
          reason,
        };
      } else {
        moderationData.bans[
          target.id
        ] = {
          expiresAt: null,
          staffId:
            interaction.user.id,
          reason,
        };
      }

      saveAll();

      const logEmbed =
        new EmbedBuilder()
          .setColor(
            0xff0000
          )
          .setTitle(
            "a member was banned"
          )
          .addFields(
            {
              name: "member",
              value:
                mentionUser(
                  target.id
                ),
            },
            {
              name: "staff",
              value:
                mentionUser(
                  interaction.user.id
                ),
            },
            {
              name: "banned for",
              value:
                duration === null
                  ? "Permanent"
                  : formatDuration(
                      duration
                    ),
            },
            {
              name: "reason",
              value:
                reason.slice(
                  0,
                  1024
                ),
            }
          )
          .setTimestamp();

      await sendLog(
        guildId,
        "bans",
        logEmbed
      );

      await interaction
        .reply({
          content:
            `${target} has been banned for **${
              duration === null
                ? "permanent"
                : formatDuration(
                    duration
                  )
            }**.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /KICK
    ===================================================== */

    if (
      originalCommand ===
      "kick"
    ) {
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      const reason =
        interaction.options.getString(
          "reason"
        ) ||
        "No reason provided";

      const member =
        await interaction.guild.members
          .fetch(target.id)
          .catch(
            () => null
          );

      if (!member) {
        await interaction
          .reply({
            content:
              "That member isn't in the server.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      await member
        .kick(reason)
        .catch(
          async () => {
            await interaction
              .reply({
                content:
                  "I couldn't kick that member. Check my Kick Members permission and role hierarchy.",
                ephemeral: true,
              })
              .catch(
                () => {}
              );
          }
        );

      const logEmbed =
        new EmbedBuilder()
          .setColor(
            0xff8800
          )
          .setTitle(
            "a member was kicked"
          )
          .addFields(
            {
              name: "member",
              value:
                mentionUser(
                  target.id
                ),
            },
            {
              name: "staff",
              value:
                mentionUser(
                  interaction.user.id
                ),
            },
            {
              name: "banned for",
              value:
                "Not applicable",
            },
            {
              name: "reason",
              value:
                reason.slice(
                  0,
                  1024
                ),
            }
          )
          .setTimestamp();

      await sendLog(
        guildId,
        "bans",
        logEmbed
      );

      await interaction
        .reply({
          content:
            `${target} has been kicked.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /SHORT
    ===================================================== */

    if (
      originalCommand ===
      "short"
    ) {
      const command =
        interaction.options.getString(
          "command",
          true
        );

      const shortcut =
        interaction.options.getString(
          "shortcut",
          true
        )
        .toLowerCase()
        .trim();

      if (
        !/^[a-z0-9_-]+$/.test(
          shortcut
        )
      ) {
        await interaction
          .reply({
            content:
              "Shortcut can only contain lowercase letters, numbers, `_` and `-`.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const reserved =
        new Set([
          "level",
          "top",
          "top-xp",
          "xp-annc",
          "xp-statue",
          "antispam-statue",
          "level-channel",
          "vafk",
          "levelling-reward",
          "rep",
          "goodrep-add",
          "badrep-add",
          "top-rep",
          "comment",
          "view-comments",
          "auto-logs",
          "warn",
          "timeout",
          "ban",
          "kick",
          "short",
        ]);

      if (
        reserved.has(
          shortcut
        )
      ) {
        await interaction
          .reply({
            content:
              "That shortcut name is already reserved by another command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const guildShortcuts =
        getGuildShortcuts(
          guildId
        );

      for (
        const [
          key,
          value,
        ] of Object.entries(
          guildShortcuts
        )
      ) {
        if (
          value ===
          shortcut
        ) {
          delete guildShortcuts[
            key
          ];
        }
      }

      guildShortcuts[
        command
      ] = shortcut;

      saveAll();

      await interaction
        .reply({
          content:
            `Done. **/${shortcut}** is now a shortcut for **/${command}** with the same member/reason/howmuch options.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      await refreshCommands();

      return;
    }
  }
);

/* =========================================================
   DAILY / WEEKLY ANNOUNCEMENTS
========================================================= */

let lastDaily = "";
let lastWeekly = "";

setInterval(
  async () => {
    const now =
      new Date();

    const dateKey =
      now
        .toISOString()
        .slice(
          0,
          10
        );

    const weekKey =
      `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

    if (
      now.getUTCHours() === 0 &&
      now.getUTCMinutes() === 0 &&
      lastDaily !== dateKey
    ) {
      lastDaily =
        dateKey;

      await sendAnnouncement(
        "daily"
      );
    }

    if (
      now.getUTCDay() === 1 &&
      now.getUTCHours() === 0 &&
      now.getUTCMinutes() === 0 &&
      lastWeekly !== weekKey
    ) {
      lastWeekly =
        weekKey;

      await sendAnnouncement(
        "weekly"
      );
    }
  },
  60_000
);

/* =========================================================
   LOGIN
========================================================= */
client.login(TOKEN);