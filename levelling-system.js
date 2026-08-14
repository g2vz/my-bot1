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
const GOOD_REP_COOLDOWN_MS = 5 * 60 * 1000;
const BAD_REP_COOLDOWN_MS = 7 * 60 * 1000;
const TOP_REP_COOLDOWN_MS = 5000;
const COMMENT_COOLDOWN_MS = 60 * 60 * 1000;

/* =========================================================
   DATA
========================================================= */

const DATA_DIR = path.join(__dirname, "data");

const LEVELS_FILE = path.join(
  DATA_DIR,
  "levels.json"
);

const ANNOUNCEMENTS_FILE = path.join(
  DATA_DIR,
  "announcements.json"
);

const SETTINGS_FILE = path.join(
  DATA_DIR,
  "settings.json"
);

const REPUTATION_FILE = path.join(
  DATA_DIR,
  "reputation.json"
);

const COMMENTS_FILE = path.join(
  DATA_DIR,
  "comments.json"
);

const LEVEL_REWARDS_FILE = path.join(
  DATA_DIR,
  "level-rewards.json"
);

const LOGS_FILE = path.join(
  DATA_DIR,
  "logs.json"
);

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

const levels = load(
  LEVELS_FILE,
  {}
);

const announcements = load(
  ANNOUNCEMENTS_FILE,
  {}
);

const settings = load(
  SETTINGS_FILE,
  {}
);

const reputation = load(
  REPUTATION_FILE,
  {}
);

const comments = load(
  COMMENTS_FILE,
  {}
);

const levelRewards = load(
  LEVEL_REWARDS_FILE,
  {}
);

const logs = load(
  LOGS_FILE,
  {}
);

function saveAll() {
  save(LEVELS_FILE, levels);
  save(ANNOUNCEMENTS_FILE, announcements);
  save(SETTINGS_FILE, settings);
  save(REPUTATION_FILE, reputation);
  save(COMMENTS_FILE, comments);
  save(LEVEL_REWARDS_FILE, levelRewards);
  save(LOGS_FILE, logs);
}

/* =========================================================
   GUILD SETTINGS
========================================================= */

function getGuildSettings(guildId) {
  if (!settings[guildId]) {
    settings[guildId] = {};
  }

  const guildSettings = settings[guildId];

  if (
    typeof guildSettings.spamEnabled !==
    "boolean"
  ) {
    guildSettings.spamEnabled = false;
  }

  if (
    !Array.isArray(
      guildSettings.spamEnabledChannels
    )
  ) {
    guildSettings.spamEnabledChannels = [];
  }

  if (
    !Array.isArray(
      guildSettings.xpEnabledChannels
    )
  ) {
    guildSettings.xpEnabledChannels = [];
  }

  if (
    guildSettings.spamExemptChannelId ===
    undefined
  ) {
    guildSettings.spamExemptChannelId = null;
  }

  if (
    guildSettings.xpExemptChannelId ===
    undefined
  ) {
    guildSettings.xpExemptChannelId = null;
  }

  if (
    guildSettings.levelChannelId ===
    undefined
  ) {
    guildSettings.levelChannelId = null;
  }

  return guildSettings;
}

/* =========================================================
   LEVEL USER
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

/* =========================================================
   XP CURVE
========================================================= */

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

/* =========================================================
   PROGRESS BAR
========================================================= */

function progressBar(
  current,
  needed,
  size = 12
) {
  if (needed <= 0) {
    return "████████████";
  }

  const percentage = Math.max(
    0,
    Math.min(
      1,
      current / needed
    )
  );

  const filled = Math.floor(
    percentage * size
  );

  return (
    "█".repeat(filled) +
    "░".repeat(size - filled)
  );
}

/* =========================================================
   RANK
========================================================= */

function getRank(
  guildId,
  userId
) {
  const users = Object.entries(
    levels[guildId] || {}
  );

  users.sort(
    (a, b) =>
      b[1].xp - a[1].xp
  );

  const index = users.findIndex(
    ([id]) => id === userId
  );

  return index === -1
    ? users.length + 1
    : index + 1;
}

/* =========================================================
   TOP XP
========================================================= */

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
   REPUTATION
========================================================= */

function getRepUser(
  guildId,
  userId
) {
  if (!reputation[guildId]) {
    reputation[guildId] = {};
  }

  if (
    reputation[guildId][userId] ===
    undefined
  ) {
    reputation[guildId][userId] = 0;
  }

  return Number(
    reputation[guildId][userId]
  );
}

function setRepUser(
  guildId,
  userId,
  value
) {
  if (!reputation[guildId]) {
    reputation[guildId] = {};
  }

  reputation[guildId][userId] =
    Number(value.toFixed(2));
}

function getRepRank(
  guildId,
  userId
) {
  const users = Object.entries(
    reputation[guildId] || {}
  );

  users.sort(
    (a, b) =>
      Number(b[1]) - Number(a[1])
  );

  const index = users.findIndex(
    ([id]) => id === userId
  );

  return index === -1
    ? users.length + 1
    : index + 1;
}

function getTopRep(guildId) {
  return Object.entries(
    reputation[guildId] || {}
  )
    .map(
      ([userId, rep]) => [
        userId,
        Number(rep),
      ]
    )
    .sort(
      (a, b) =>
        b[1] - a[1]
    )
    .slice(0, 100);
}

/* =========================================================
   COMMENTS
========================================================= */

function getUserComments(
  guildId,
  userId
) {
  if (!comments[guildId]) {
    comments[guildId] = {};
  }

  if (!Array.isArray(comments[guildId][userId])) {
    comments[guildId][userId] = [];
  }

  return comments[guildId][userId];
}

/* =========================================================
   LEVEL REWARDS
========================================================= */

function getGuildLevelRewards(
  guildId
) {
  if (!levelRewards[guildId]) {
    levelRewards[guildId] = {};
  }

  return levelRewards[guildId];
}

/* =========================================================
   SPAM MEMORY
========================================================= */

const spamTracker = new Map();
const spamActionLock = new Map();
const spamStrikes = new Map();

/* =========================================================
   COOLDOWNS
========================================================= */

const commandCooldowns = new Map();

function cooldownRemaining(
  map,
  key,
  duration
) {
  const now = Date.now();

  const last =
    map.get(key) || 0;

  const remaining =
    duration -
    (now - last);

  if (remaining > 0) {
    return remaining;
  }

  map.set(key, now);

  return 0;
}

/* =========================================================
   COMMAND COOLDOWN
========================================================= */

function checkCommandCooldown(
  interaction
) {
  const key =
    `${interaction.guild.id}:${interaction.user.id}:${interaction.commandName}`;

  return cooldownRemaining(
    commandCooldowns,
    key,
    COMMAND_COOLDOWN_MS
  );
}

/* =========================================================
   PERMISSIONS
========================================================= */

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
      PermissionFlagsBits.Administrator
    )
  );
}

function isAdministrator(member) {
  if (!member) {
    return false;
  }

  return (
    member.permissions.has(
      PermissionFlagsBits.ManageGuild
    ) ||
    member.permissions.has(
      PermissionFlagsBits.Administrator
    )
  );
}

/* =========================================================
   SPAM HELPERS
========================================================= */

function getSpamKey(
  guildId,
  userId
) {
  return `${guildId}:${userId}`;
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

/* =========================================================
   REGISTER SPAM MESSAGE
========================================================= */

function registerSpamMessage(
  message
) {
  const key =
    getSpamKey(
      message.guild.id,
      message.author.id
    );

  const now = Date.now();

  let entries =
    spamTracker.get(key) || [];

  entries =
    entries.filter(
      (entry) =>
        now - entry.timestamp <=
        SPAM_WINDOW_MS
    );

  entries.push({
    timestamp: now,
    messageId: message.id,
  });

  spamTracker.set(
    key,
    entries
  );

  return entries;
}

/* =========================================================
   DELETE SPAM MESSAGES
========================================================= */

async function deleteSpamMessages(
  message,
  entries
) {
  const channel =
    message.channel;

  for (const entry of entries) {
    const spamMessage =
      await channel.messages
        .fetch(entry.messageId)
        .catch(
          () => null
        );

    if (!spamMessage) {
      continue;
    }

    await spamMessage
      .delete()
      .catch(
        () => {}
      );
  }
}

/* =========================================================
   HANDLE SPAM
========================================================= */

async function handleSpam(message) {
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

  /*
    Global anti-spam is disabled
    unless at least one channel has
    explicitly been enabled.
  */

  const channelEnabled =
    guildSettings.spamEnabledChannels.includes(
      message.channel.id
    );

  if (
    !guildSettings.spamEnabled ||
    !channelEnabled
  ) {
    return false;
  }

  if (
    guildSettings.spamExemptChannelId ===
    message.channel.id
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

  const entries =
    registerSpamMessage(
      message
    );

  if (
    entries.length <=
    SPAM_MESSAGE_LIMIT
  ) {
    return false;
  }

  if (isSpamLocked(key)) {
    return true;
  }

  spamActionLock.set(
    key,
    Date.now() +
      SPAM_ACTION_DELAY_MS
  );

  clearSpamTracker(key);

  /*
    Delete the first message and
    everything else inside the
    spam window.
  */

  await deleteSpamMessages(
    message,
    entries
  );

  const previousStrike =
    spamStrikes.get(key) || 0;

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
   LOGGING
========================================================= */

const LOG_TYPES = [
  "bans-kicks",
  "timeouts",
  "channels-categories",
  "messages",
  "roles",
];

function getGuildLogs(
  guildId
) {
  if (!logs[guildId]) {
    logs[guildId] = {
      enabled: false,
      categoryId: null,
      channels: {
        "bans-kicks": null,
        timeouts: null,
        "channels-categories": null,
        messages: null,
        roles: null,
      },
    };
  }

  if (
    !logs[guildId].channels
  ) {
    logs[guildId].channels = {};
  }

  for (
    const type of LOG_TYPES
  ) {
    if (
      logs[guildId].channels[type] ===
      undefined
    ) {
      logs[guildId].channels[type] =
        null;
    }
  }

  return logs[guildId];
}

async function sendLog(
  guild,
  type,
  embed
) {
  const config =
    getGuildLogs(
      guild.id
    );

  if (!config.enabled) {
    return;
  }

  const channelId =
    config.channels[type];

  if (!channelId) {
    return;
  }

  const channel =
    guild.channels.cache.get(
      channelId
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return;
  }

  await channel
    .send({
      embeds: [
        embed,
      ],
    })
    .catch(
      () => {}
    );
}

function logEmbed(
  title,
  description,
  color = 0x00d4ff
) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      description
    )
    .setTimestamp();
}

async function getAuditExecutor(
  guild,
  type
) {
  try {
    const logsFetched =
      await guild.fetchAuditLogs({
        type,
        limit: 1,
      });

    const entry =
      logsFetched.entries.first();

    if (!entry) {
      return null;
    }

    return entry.executor;
  } catch {
    return null;
  }
}

/* =========================================================
   CREATE AUTO LOGS
========================================================= */

async function createAutoLogs(
  guild
) {
  const config =
    getGuildLogs(
      guild.id
    );

  let category = null;

  if (config.categoryId) {
    category =
      guild.channels.cache.get(
        config.categoryId
      );
  }

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

    config.categoryId =
      category.id;
  }

  const channelNames = {
    "bans-kicks":
      "bans-kicks",
    timeouts:
      "timeouts",
    "channels-categories":
      "channels-categories",
    messages:
      "messages",
    roles:
      "roles",
  };

  for (
    const type of LOG_TYPES
  ) {
    let channel =
      config.channels[type]
        ? guild.channels.cache.get(
            config.channels[type]
          )
        : null;

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      channel =
        await guild.channels
          .create({
            name:
              channelNames[type],
            type:
              ChannelType.GuildText,
            parent:
              category.id,
          })
          .catch(
            () => null
          );

      if (channel) {
        config.channels[type] =
          channel.id;
      }
    }
  }

  config.enabled = true;

  saveAll();

  return true;
}

/* =========================================================
   SLASH COMMANDS
========================================================= */

const commands = [
  /* =====================================================
     /level
  ===================================================== */

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

  /* =====================================================
     /top
  ===================================================== */

  new SlashCommandBuilder()
    .setName("top")
    .setDescription(
      "Show the top 100 members by XP"
    ),

  /* =====================================================
     /xp-annc
  ===================================================== */

  new SlashCommandBuilder()
    .setName("xp-annc")
    .setDescription(
      "Configure daily or weekly XP announcements"
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
            "Channel where announcement will be sent"
          )
          .setRequired(false)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
    ),

  /* =====================================================
     /spam-exempt
  ===================================================== */

  new SlashCommandBuilder()
    .setName("spam-exempt")
    .setDescription(
      "Set a channel where anti-spam timeouts are disabled"
    )
    .addStringOption(
      (option) =>
        option
          .setName("mode")
          .setDescription(
            "Enable or disable exempt channel"
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
            "Channel to exempt from spam timeouts"
          )
          .setRequired(false)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
    ),

  /* =====================================================
     /xp-exempt
  ===================================================== */

  new SlashCommandBuilder()
    .setName("xp-exempt")
    .setDescription(
      "Set a channel where messages do not give XP"
    )
    .addStringOption(
      (option) =>
        option
          .setName("mode")
          .setDescription(
            "Set or disable XP exempt channel"
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
            "Channel where XP is disabled"
          )
          .setRequired(false)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
    ),

  /* =====================================================
     /level-channel
  ===================================================== */

  new SlashCommandBuilder()
    .setName("level-channel")
    .setDescription(
      "Set the channel where level-up messages are sent"
    )
    .addStringOption(
      (option) =>
        option
          .setName("mode")
          .setDescription(
            "Set or disable level-up channel"
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
            "Channel where level-ups are announced"
          )
          .setRequired(false)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
    ),

  /* =====================================================
     /vafk
  ===================================================== */

  new SlashCommandBuilder()
    .setName("vafk")
    .setDescription(
      "Make the bot join a voice channel and stay AFK"
    )
    .addChannelOption(
      (option) =>
        option
          .setName("channel")
          .setDescription(
            "Voice channel for the bot"
          )
          .setRequired(true)
          .addChannelTypes(
            ChannelType.GuildVoice
          )
    ),

  /* =====================================================
     /xp-statue
  ===================================================== */

  new SlashCommandBuilder()
    .setName("xp-statue")
    .setDescription(
      "Enable or disable XP in a channel"
    )
    .addStringOption(
      (option) =>
        option
          .setName("mode")
          .setDescription(
            "Turn XP on or off"
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

  /* =====================================================
     /antispam-statue
  ===================================================== */

  new SlashCommandBuilder()
    .setName("antispam-statue")
    .setDescription(
      "Enable or disable anti-spam protection"
    )
    .addStringOption(
      (option) =>
        option
          .setName("mode")
          .setDescription(
            "Turn anti-spam on or off"
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

  /* =====================================================
     /rep
  ===================================================== */

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

  /* =====================================================
     /goodrep-add
  ===================================================== */

  new SlashCommandBuilder()
    .setName("goodrep-add")
    .setDescription(
      "Give a member +1 reputation"
    )
    .addUserOption(
      (option) =>
        option
          .setName("member")
          .setDescription(
            "Member to give reputation to"
          )
          .setRequired(true)
    ),

  /* =====================================================
     /badrep-add
  ===================================================== */

  new SlashCommandBuilder()
    .setName("badrep-add")
    .setDescription(
      "Give a member -0.50 reputation"
    )
    .addUserOption(
      (option) =>
        option
          .setName("member")
          .setDescription(
            "Member to give negative reputation to"
          )
          .setRequired(true)
    ),

  /* =====================================================
     /top-rep
  ===================================================== */

  new SlashCommandBuilder()
    .setName("top-rep")
    .setDescription(
      "Show the top 100 members by reputation"
    ),

  /* =====================================================
     /comment
  ===================================================== */

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
            "Member to send the impression to"
          )
          .setRequired(true)
    )
    .addStringOption(
      (option) =>
        option
          .setName("text")
          .setDescription(
            "Your anonymous impression"
          )
          .setRequired(true)
          .setMaxLength(1000)
    ),

  /* =====================================================
     /view-comments
  ===================================================== */

  new SlashCommandBuilder()
    .setName("view-comments")
    .setDescription(
      "View anonymous impressions sent to you"
    )
    .addStringOption(
      (option) =>
        option
          .setName("hidden")
          .setDescription(
            "Hide the response from everyone else"
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

  /* =====================================================
     /level-reward
  ===================================================== */

  new SlashCommandBuilder()
    .setName("level-reward")
    .setDescription(
      "Set or remove a role reward for a specific level"
    )
    .addIntegerOption(
      (option) =>
        option
          .setName("level")
          .setDescription(
            "The level required"
          )
          .setRequired(true)
          .setMinValue(1)
    )
    .addRoleOption(
      (option) =>
        option
          .setName("role")
          .setDescription(
            "Role given at this level"
          )
          .setRequired(false)
    )
    .addStringOption(
      (option) =>
        option
          .setName("mode")
          .setDescription(
            "Set or remove the reward"
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
    ),

  /* =====================================================
     /auto-logs
  ===================================================== */

  new SlashCommandBuilder()
    .setName("auto-logs")
    .setDescription(
      "Enable or disable automatic server logs"
    )
    .addStringOption(
      (option) =>
        option
          .setName("mode")
          .setDescription(
            "Turn automatic logs on or off"
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
    ),
].map(
  (command) =>
    command.toJSON()
);

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

/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {
  const rest =
    new REST({
      version: "10",
    }).setToken(TOKEN);

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
   VAFK
========================================================= */

/*
  IMPORTANT:
  The bot does NOT automatically reconnect.

  /vafk is the only thing that starts
  the voice connection.

  If the bot is kicked, disconnected,
  or the channel is deleted, it stays
  disconnected until /vafk is used again.
*/

async function joinVAFKVoice(
  channel
) {
  if (!channel) {
    return false;
  }

  if (
    channel.type !==
    ChannelType.GuildVoice
  ) {
    return false;
  }

  try {
    const existing =
      getVoiceConnection(
        channel.guild.id
      );

    if (existing) {
      existing.destroy();
    }

    const connection =
      joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator:
          channel.guild
            .voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
      });

    connection.on(
      "error",
      (error) => {
        console.error(
          "VAFK voice connection error:",
          error
        );
      }
    );

    connection.on(
      "stateChange",
      (
        oldState,
        newState
      ) => {
        console.log(
          `VAFK voice state: ${oldState.status} -> ${newState.status}`
        );
      }
    );

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

    /* =====================================================
       ANTI-SPAM
    ===================================================== */

    const wasSpam =
      await handleSpam(message);

    if (wasSpam) {
      return;
    }

    /* =====================================================
       SERVER SETTINGS
    ===================================================== */

    const guildSettings =
      getGuildSettings(
        message.guild.id
      );

    /* =====================================================
       XP EXEMPT CHANNEL
    ===================================================== */

    if (
      guildSettings.xpExemptChannelId ===
      message.channel.id
    ) {
      return;
    }

    /*
      XP is only active in channels
      explicitly enabled with /xp-statue on.
    */

    if (
      !guildSettings.xpEnabledChannels.includes(
        message.channel.id
      )
    ) {
      return;
    }

    /* =====================================================
       WORDS
    ===================================================== */

    const words =
      message.content
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!words.length) {
      return;
    }

    /* =====================================================
       USER
    ===================================================== */

    const user =
      getUser(
        message.guild.id,
        message.author.id
      );

    const oldLevel =
      Number(user.level) || 0;

    /* =====================================================
       NORMAL XP
       1 - 10 PER WORD
    ===================================================== */

    let xpPerWord =
      Math.floor(
        Math.random() * 10
      ) + 1;

    /* =====================================================
       13% BONUS
       11 - 100 PER WORD
    ===================================================== */

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

    /* =====================================================
       CALCULATE LEVEL
    ===================================================== */

    const newLevel =
      calculateLevel(
        user.xp
      );

    user.level =
      newLevel;

    saveAll();

    /* =====================================================
       LEVEL UP
    ===================================================== */

    if (
      newLevel <= oldLevel
    ) {
      return;
    }

    /* =====================================================
       LEVEL REWARD
    ===================================================== */

    const rewards =
      getGuildLevelRewards(
        message.guild.id
      );

    for (
      let reachedLevel =
        oldLevel + 1;
      reachedLevel <=
        newLevel;
      reachedLevel++
    ) {
      const rewardRoleId =
        rewards[
          String(reachedLevel)
        ];

      if (!rewardRoleId) {
        continue;
      }

      const rewardRole =
        message.guild.roles.cache.get(
          rewardRoleId
        );

      if (!rewardRole) {
        continue;
      }

      const member =
        await message.guild.members
          .fetch(
            message.author.id
          )
          .catch(
            () => null
          );

      if (!member) {
        continue;
      }

      if (
        !member.roles.cache.has(
          rewardRole.id
        )
      ) {
        await member.roles
          .add(
            rewardRole,
            `Reached level ${reachedLevel}`
          )
          .catch(
            (error) => {
              console.error(
                "Failed to give level reward role:",
                error
              );
            }
          );
      }
    }

    /* =====================================================
       LEVEL CHANNEL
    ===================================================== */

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

    /* =====================================================
       LEVEL PROGRESS
    ===================================================== */

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

    /* =====================================================
       LEVEL EMBED
    ===================================================== */

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
        (error) => {
          console.error(
            "Failed to send level-up message:",
            error
          );
        }
      );
  }
);

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
      `**#${start + i + 1}** ${name} • Level **${user.level}** • **${user.xp.toFixed(2)} XP**`
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
   REP ANNOUNCEMENT
========================================================= */

async function buildRepAnnouncement(
  guildId,
  page = 0
) {
  const top =
    getTopRep(guildId);

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

  const rows = [];

  for (
    let i = 0;
    i < pageUsers.length;
    i++
  ) {
    const [
      userId,
      rep,
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
      `**#${start + i + 1}** ${name} • **${Number(rep).toFixed(2)} reputation**`
    );
  }

  const embed =
    new EmbedBuilder()
      .setColor(
        0x81c1eb
      )
      .setTitle(
        "top reputation"
      )
      .setDescription(
        rows.length
          ? rows.join("\n")
          : "No reputation data yet."
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
            `rep_prev_${guildId}`
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
            `rep_next_${guildId}`
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

async function sendAnnouncement(type) {
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
   DAILY / WEEKLY TIMER
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
   MESSAGE DELETE LOG
========================================================= */

client.on(
  Events.MessageDelete,
  async (message) => {
    if (!message.guild) {
      return;
    }

    if (message.author?.bot) {
      return;
    }

    const author =
      message.author
        ? `${message.author.tag} (${message.author.id})`
        : "Unknown user";

    const content =
      message.content ||
      "Content unavailable";

    const embed =
      logEmbed(
        "Message Deleted",
        `**Author:** ${author}\n**Channel:** ${message.channel}\n\n**Message:**\n${content}`,
        0xff4d4d
      );

    await sendLog(
      message.guild,
      "messages",
      embed
    );
  }
);

/* =========================================================
   MESSAGE UPDATE LOG
========================================================= */

client.on(
  Events.MessageUpdate,
  async (
    oldMessage,
    newMessage
  ) => {
    if (!newMessage.guild) {
      return;
    }

    if (
      newMessage.author?.bot
    ) {
      return;
    }

    const oldContent =
      oldMessage.content ||
      "Unavailable";

    const newContent =
      newMessage.content ||
      "Unavailable";

    if (
      oldContent ===
      newContent
    ) {
      return;
    }

    const embed =
      logEmbed(
        "Message Edited",
        `**Author:** ${newMessage.author}\n**Channel:** ${newMessage.channel}\n\n**Before:**\n${oldContent}\n\n**After:**\n${newContent}`,
        0xffcc00
      );

    await sendLog(
      newMessage.guild,
      "messages",
      embed
    );
  }
);

/* =========================================================
   MEMBER BAN LOG
========================================================= */

client.on(
  Events.GuildBanAdd,
  async (ban) => {
    const executor =
      await getAuditExecutor(
        ban.guild,
        AuditLogEvent.MemberBanAdd
      );

    const embed =
      logEmbed(
        "Member Banned",
        `**Member:** ${ban.user.tag} (${ban.user.id})\n**Moderator:** ${
          executor
            ? `${executor.tag} (${executor.id})`
            : "Unknown"
        }`,
        0xff0000
      );

    await sendLog(
      ban.guild,
      "bans-kicks",
      embed
    );
  }
);

/* =========================================================
   MEMBER UNBAN LOG
========================================================= */

client.on(
  Events.GuildBanRemove,
  async (ban) => {
    const executor =
      await getAuditExecutor(
        ban.guild,
        AuditLogEvent.MemberBanRemove
      );

    const embed =
      logEmbed(
        "Member Unbanned",
        `**Member:** ${ban.user.tag} (${ban.user.id})\n**Moderator:** ${
          executor
            ? `${executor.tag} (${executor.id})`
            : "Unknown"
        }`,
        0x00cc66
      );

    await sendLog(
      ban.guild,
      "bans-kicks",
      embed
    );
  }
);

/* =========================================================
   MEMBER UPDATE LOG
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

    const embed =
      logEmbed(
        newTimeout
          ? "Member Timed Out"
          : "Member Timeout Removed",
        `**Member:** ${newMember.user.tag} (${newMember.id})`,
        newTimeout
          ? 0xff9900
          : 0x00cc66
      );

    await sendLog(
      newMember.guild,
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

    const embed =
      logEmbed(
        "Channel Created",
        `**Channel:** ${channel}\n**Name:** ${channel.name}\n**Type:** ${channel.type}`,
        0x00cc66
      );

    await sendLog(
      channel.guild,
      "channels-categories",
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

    const embed =
      logEmbed(
        "Channel Deleted",
        `**Name:** ${channel.name}\n**ID:** ${channel.id}\n**Type:** ${channel.type}`,
        0xff0000
      );

    await sendLog(
      channel.guild,
      "channels-categories",
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
        `**Name:** ${oldChannel.name} → ${newChannel.name}`
      );
    }

    if (
      oldChannel.parentId !==
      newChannel.parentId
    ) {
      changes.push(
        `**Category:** ${oldChannel.parentId || "None"} → ${newChannel.parentId || "None"}`
      );
    }

    if (
      !changes.length
    ) {
      return;
    }

    const embed =
      logEmbed(
        "Channel Updated",
        `**Channel:** ${newChannel}\n\n${changes.join("\n")}`,
        0xffcc00
      );

    await sendLog(
      newChannel.guild,
      "channels-categories",
      embed
    );
  }
);

/* =========================================================
   ROLE CREATE
========================================================= */

client.on(
  Events.GuildRoleCreate,
  async (role) => {
    const embed =
      logEmbed(
        "Role Created",
        `**Role:** ${role}\n**Name:** ${role.name}\n**ID:** ${role.id}`,
        0x00cc66
      );

    await sendLog(
      role.guild,
      "roles",
      embed
    );
  }
);

/* =========================================================
   ROLE DELETE
========================================================= */

client.on(
  Events.GuildRoleDelete,
  async (role) => {
    const embed =
      logEmbed(
        "Role Deleted",
        `**Name:** ${role.name}\n**ID:** ${role.id}`,
        0xff0000
      );

    await sendLog(
      role.guild,
      "roles",
      embed
    );
  }
);

/* =========================================================
   ROLE UPDATE
========================================================= */

client.on(
  Events.GuildRoleUpdate,
  async (
    oldRole,
    newRole
  ) => {
    const changes = [];

    if (
      oldRole.name !==
      newRole.name
    ) {
      changes.push(
        `**Name:** ${oldRole.name} → ${newRole.name}`
      );
    }

    if (
      oldRole.color !==
      newRole.color
    ) {
      changes.push(
        `**Color:** ${oldRole.hexColor} → ${newRole.hexColor}`
      );
    }

    if (
      oldRole.permissions.bitfield !==
      newRole.permissions.bitfield
    ) {
      changes.push(
        "**Permissions:** Changed"
      );
    }

    if (
      !changes.length
    ) {
      return;
    }

    const embed =
      logEmbed(
        "Role Updated",
        `**Role:** ${newRole}\n\n${changes.join("\n")}`,
        0xffcc00
      );

    await sendLog(
      newRole.guild,
      "roles",
      embed
    );
  }
);

/* =========================================================
   MEMBER ROLE ADD / REMOVE LOG
========================================================= */

client.on(
  Events.GuildMemberUpdate,
  async (
    oldMember,
    newMember
  ) => {
    const oldRoles =
      new Set(
        oldMember.roles.cache.keys()
      );

    const newRoles =
      new Set(
        newMember.roles.cache.keys()
      );

    const addedRoles = [];

    for (
      const roleId of newRoles
    ) {
      if (
        roleId ===
        newMember.guild.id
      ) {
        continue;
      }

      if (
        !oldRoles.has(roleId)
      ) {
        const role =
          newMember.guild.roles.cache.get(
            roleId
          );

        if (role) {
          addedRoles.push(
            role
          );
        }
      }
    }

    const removedRoles = [];

    for (
      const roleId of oldRoles
    ) {
      if (
        roleId ===
        newMember.guild.id
      ) {
        continue;
      }

      if (
        !newRoles.has(roleId)
      ) {
        const role =
          newMember.guild.roles.cache.get(
            roleId
          );

        if (role) {
          removedRoles.push(
            role
          );
        }
      }
    }

    if (
      addedRoles.length
    ) {
      const embed =
        logEmbed(
          "Role Added",
          `**Member:** ${newMember.user.tag}\n**Roles:** ${addedRoles
            .map(
              (role) =>
                `${role.name} (${role.id})`
            )
            .join(", ")}`,
          0x00cc66
        );

      await sendLog(
        newMember.guild,
        "roles",
        embed
      );
    }

    if (
      removedRoles.length
    ) {
      const embed =
        logEmbed(
          "Role Removed",
          `**Member:** ${newMember.user.tag}\n**Roles:** ${removedRoles
            .map(
              (role) =>
                `${role.name} (${role.id})`
            )
            .join(", ")}`,
          0xff9900
        );

      await sendLog(
        newMember.guild,
        "roles",
        embed
      );
    }
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

      /* ===================================================
         XP BUTTON
      =================================================== */

      if (
        parts[0] === "xp"
      ) {
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

      /* ===================================================
         REP BUTTON
      =================================================== */

      if (
        parts[0] === "rep"
      ) {
        const direction =
          parts[1];

        const guildIdFromButton =
          parts[2];

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
          await buildRepAnnouncement(
            guildIdFromButton,
            newPage
          );

        await interaction
          .update(updated)
          .catch(
            () => {}
          );

        return;
      }

      return;
    }

    /* =====================================================
       SLASH COMMANDS ONLY
    ===================================================== */

    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    const cooldown =
      checkCommandCooldown(
        interaction
      );

    if (cooldown > 0) {
      await interaction
        .reply({
          content:
            `Please wait ${Math.ceil(
              cooldown / 1000
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

    /* =====================================================
       /LEVEL
    ===================================================== */

    if (
      interaction.commandName ===
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
                `**${user.xp.toFixed(2)}**`,
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
                `**${user.messages.toLocaleString()}**`,
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
       /TOP
    ===================================================== */

    if (
      interaction.commandName ===
      "top"
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
      interaction.commandName ===
      "xp-annc"
    ) {
      if (
        !isAdministrator(
          interaction.member
        )
      ) {
        await interaction
          .reply({
            content:
              "You need administrator permissions to use this command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

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
       /VAFK
    ===================================================== */

    if (
      interaction.commandName ===
      "vafk"
    ) {
      if (
        !isAdministrator(
          interaction.member
        )
      ) {
        await interaction
          .reply({
            content:
              "You need administrator permissions to use this command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const channel =
        interaction.options.getChannel(
          "channel",
          true
        );

      if (
        channel.type !==
        ChannelType.GuildVoice
      ) {
        await interaction
          .reply({
            content:
              "Please select a voice channel.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const joined =
        await joinVAFKVoice(
          channel
        );

      if (!joined) {
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
            `I joined ${channel} and will stay AFK there until I am disconnected, kicked, or the channel is deleted. I will NOT reconnect automatically. Use /vafk again if you want me back.`,
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
      interaction.commandName ===
      "xp-statue"
    ) {
      if (
        !isAdministrator(
          interaction.member
        )
      ) {
        await interaction
          .reply({
            content:
              "You need administrator permissions to use this command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

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
        No channel = disable XP completely.
      */

      if (!channel) {
        guildSettings.xpEnabledChannels =
          [];

        saveAll();

        await interaction
          .reply({
            content:
              "XP has been completely disabled because no channel was selected.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      if (
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

      if (
        mode === "on"
      ) {
        if (
          !guildSettings.xpEnabledChannels.includes(
            channel.id
          )
        ) {
          guildSettings.xpEnabledChannels.push(
            channel.id
          );
        }

        saveAll();

        await interaction
          .reply({
            content:
              `XP is now enabled in ${channel}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );
      } else {
        guildSettings.xpEnabledChannels =
          guildSettings.xpEnabledChannels.filter(
            (id) =>
              id !== channel.id
          );

        saveAll();

        await interaction
          .reply({
            content:
              `XP is now disabled in ${channel}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );
      }

      return;
    }

    /* =====================================================
       /ANTISPAM-STATUE
    ===================================================== */

    if (
      interaction.commandName ===
      "antispam-statue"
    ) {
      if (
        !isAdministrator(
          interaction.member
        )
      ) {
        await interaction
          .reply({
            content:
              "You need administrator permissions to use this command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

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
        No channel = turn anti-spam
        completely off.
      */

      if (!channel) {
        guildSettings.spamEnabled =
          false;

        guildSettings.spamEnabledChannels =
          [];

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
              "Anti-spam has been completely disabled because no channel was selected.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      if (
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

      if (
        mode === "on"
      ) {
        guildSettings.spamEnabled =
          true;

        if (
          !guildSettings.spamEnabledChannels.includes(
            channel.id
          )
        ) {
          guildSettings.spamEnabledChannels.push(
            channel.id
          );
        }

        saveAll();

        await interaction
          .reply({
            content:
              `Anti-spam is now enabled in ${channel}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );
      } else {
        guildSettings.spamEnabledChannels =
          guildSettings.spamEnabledChannels.filter(
            (id) =>
              id !== channel.id
          );

        if (
          guildSettings.spamEnabledChannels
            .length === 0
        ) {
          guildSettings.spamEnabled =
            false;
        }

        saveAll();

        await interaction
          .reply({
            content:
              `Anti-spam is now disabled in ${channel}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );
      }

      return;
    }

    /* =====================================================
       /SPAM-EXEMPT
    ===================================================== */

    if (
      interaction.commandName ===
      "spam-exempt"
    ) {
      if (
        !isAdministrator(
          interaction.member
        )
      ) {
        await interaction
          .reply({
            content:
              "You need administrator permissions to use this command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

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
        guildSettings.spamExemptChannelId =
          null;

        saveAll();

        await interaction
          .reply({
            content:
              "Spam channel exemption has been disabled.",
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

      guildSettings.spamExemptChannelId =
        channel.id;

      saveAll();

      await interaction
        .reply({
          content:
            `Anti-spam timeout protection is now disabled in ${channel}.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /XP-EXEMPT
    ===================================================== */

    if (
      interaction.commandName ===
      "xp-exempt"
    ) {
      if (
        !isAdministrator(
          interaction.member
        )
      ) {
        await interaction
          .reply({
            content:
              "You need administrator permissions to use this command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

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
        guildSettings.xpExemptChannelId =
          null;

        saveAll();

        await interaction
          .reply({
            content:
              "XP channel exemption has been disabled.",
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

      guildSettings.xpExemptChannelId =
        channel.id;

      saveAll();

      await interaction
        .reply({
          content:
            `Messages in ${channel} will no longer give XP.`,
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
      interaction.commandName ===
      "level-channel"
    ) {
      if (
        !isAdministrator(
          interaction.member
        )
      ) {
        await interaction
          .reply({
            content:
              "You need administrator permissions to use this command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

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
       /REP
    ===================================================== */

    if (
      interaction.commandName ===
      "rep"
    ) {
      const target =
        interaction.options.getUser(
          "member"
        ) ||
        interaction.user;

      const key =
        `${guildId}:${interaction.user.id}:rep:${target.id}`;

      const remaining =
        cooldownRemaining(
          commandCooldowns,
          key,
          REP_VIEW_COOLDOWN_MS
        );

      if (remaining > 0) {
        await interaction
          .reply({
            content:
              `Please wait ${Math.ceil(
                remaining / 1000
              )} second(s).`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const member =
        await interaction.guild.members
          .fetch(target.id)
          .catch(
            () => null
          );

      const displayName =
        member?.displayName ||
        target.username;

      const rep =
        getRepUser(
          guildId,
          target.id
        );

      const rank =
        getRepRank(
          guildId,
          target.id
        );

      const embed =
        new EmbedBuilder()
          .setColor(
            0x81c1eb
          )
          .setAuthor({
            name:
              `${displayName}'s reputation`,
            iconURL:
              target.displayAvatarURL(),
          })
          .setDescription(
            `**Reputation:** ${rep.toFixed(2)}\n` +
              `**Rank:** #${rank}`
          )
          .setThumbnail(
            target.displayAvatarURL()
          )
          .setFooter({
            text:
              "Reputation is based on the server's community ratings.",
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
       /GOODREP-ADD
    ===================================================== */

    if (
      interaction.commandName ===
      "goodrep-add"
    ) {
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      if (
        target.id ===
        interaction.user.id
      ) {
        await interaction
          .reply({
            content:
              "You cannot give reputation to yourself.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const key =
        `${guildId}:${interaction.user.id}:goodrep`;

      const remaining =
        cooldownRemaining(
          commandCooldowns,
          key,
          GOOD_REP_COOLDOWN_MS
        );

      if (remaining > 0) {
        await interaction
          .reply({
            content:
              `Please wait ${Math.ceil(
                remaining / 60000
              )} minute(s) before giving good reputation again.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const current =
        getRepUser(
          guildId,
          target.id
        );

      setRepUser(
        guildId,
        target.id,
        current + 1
      );

      saveAll();

      await interaction
        .reply({
          content:
            `${target} received **+1 reputation**.`,
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
      interaction.commandName ===
      "badrep-add"
    ) {
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      if (
        target.id ===
        interaction.user.id
      ) {
        await interaction
          .reply({
            content:
              "You cannot give reputation to yourself.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const key =
        `${guildId}:${interaction.user.id}:badrep`;

      const remaining =
        cooldownRemaining(
          commandCooldowns,
          key,
          BAD_REP_COOLDOWN_MS
        );

      if (remaining > 0) {
        await interaction
          .reply({
            content:
              `Please wait ${Math.ceil(
                remaining / 60000
              )} minute(s) before giving bad reputation again.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const current =
        getRepUser(
          guildId,
          target.id
        );

      setRepUser(
        guildId,
        target.id,
        current - 0.5
      );

      saveAll();

      await interaction
        .reply({
          content:
            `${target} received **-0.50 reputation**.`,
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
      interaction.commandName ===
      "top-rep"
    ) {
      const key =
        `${guildId}:${interaction.user.id}:top-rep`;

      const remaining =
        cooldownRemaining(
          commandCooldowns,
          key,
          TOP_REP_COOLDOWN_MS
        );

      if (remaining > 0) {
        await interaction
          .reply({
            content:
              `Please wait ${Math.ceil(
                remaining / 1000
              )} second(s).`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const announcement =
        await buildRepAnnouncement(
          guildId,
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
       /COMMENT
    ===================================================== */

    if (
      interaction.commandName ===
      "comment"
    ) {
      const key =
        `${guildId}:${interaction.user.id}:comment`;

      const remaining =
        cooldownRemaining(
          commandCooldowns,
          key,
          COMMENT_COOLDOWN_MS
        );

      if (remaining > 0) {
        await interaction
          .reply({
            content:
              `You can send another comment in ${Math.ceil(
                remaining / 60000
              )} minute(s).`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const target =
        interaction.options.getUser(
          "member",
          true
        );

      const text =
        interaction.options.getString(
          "text",
          true
        );

      if (
        target.id ===
        interaction.user.id
      ) {
        await interaction
          .reply({
            content:
              "You cannot send an anonymous impression to yourself.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const targetComments =
        getUserComments(
          guildId,
          target.id
        );

      targetComments.push({
        id:
          `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        text,
        createdAt:
          new Date().toISOString(),
      });

      saveAll();

      try {
        const dm =
          await target.createDM();

        await dm.send({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x81c1eb
              )
              .setTitle(
                "You received an anonymous impression"
              )
              .setDescription(
                text
              )
              .setFooter({
                text:
                  "The sender's identity is hidden.",
              })
              .setTimestamp(),
          ],
        });
      } catch (error) {
        console.error(
          "Failed to send comment DM:",
          error
        );
      }

      await interaction
        .reply({
          content:
            `${target} received your anonymous impression in their DMs.`,
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
      interaction.commandName ===
      "view-comments"
    ) {
      const hidden =
        interaction.options.getString(
          "hidden"
        );

      const targetComments =
        getUserComments(
          guildId,
          interaction.user.id
        );

      if (
        !targetComments.length
      ) {
        await interaction
          .reply({
            content:
              "You do not have any anonymous impressions yet.",
            ephemeral:
              hidden !== "no",
          })
          .catch(
            () => {}
          );

        return;
      }

      const lines =
        targetComments.map(
          (comment, index) =>
            `**#${index + 1}**\n${comment.text}`
        );

      const embed =
        new EmbedBuilder()
          .setColor(
            0x81c1eb
          )
          .setTitle(
            "Your anonymous impressions"
          )
          .setDescription(
            lines.join(
              "\n\n"
            )
          )
          .setFooter({
            text:
              `${targetComments.length} impression(s)`,
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
       /LEVEL-REWARD
    ===================================================== */

    if (
      interaction.commandName ===
      "level-reward"
    ) {
      if (
        !isAdministrator(
          interaction.member
        )
      ) {
        await interaction
          .reply({
            content:
              "You need administrator permissions to use this command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const level =
        interaction.options.getInteger(
          "level",
          true
        );

      const role =
        interaction.options.getRole(
          "role"
        );

      const mode =
        interaction.options.getString(
          "mode",
          true
        );

      const rewards =
        getGuildLevelRewards(
          guildId
        );

      if (
        mode === "off"
      ) {
        delete rewards[
          String(level)
        ];

        saveAll();

        await interaction
          .reply({
            content:
              `The reward for level ${level} has been disabled.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      if (!role) {
        await interaction
          .reply({
            content:
              "Please select a role when using Set.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      if (
        role.id ===
        interaction.guild.id
      ) {
        await interaction
          .reply({
            content:
              "That role cannot be used as a level reward.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const botMember =
        interaction.guild.members.me;

      if (
        !botMember ||
        !botMember.permissions.has(
          PermissionFlagsBits.ManageRoles
        )
      ) {
        await interaction
          .reply({
            content:
              "I need the Manage Roles permission to give level rewards.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      if (
        role.position >=
        botMember.roles.highest.position
      ) {
        await interaction
          .reply({
            content:
              "That role is higher than or equal to my highest role, so I cannot give it.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      rewards[
        String(level)
      ] = role.id;

      saveAll();

      await interaction
        .reply({
          content:
            `When a member reaches **Level ${level}**, they will receive ${role}.`,
          ephemeral: true,
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
      interaction.commandName ===
      "auto-logs"
    ) {
      if (
        !isModerator(
          interaction.member
        )
      ) {
        await interaction
          .reply({
            content:
              "Only moderators can use the auto-logs command.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const mode =
        interaction.options.getString(
          "mode",
          true
        );

      const config =
        getGuildLogs(
          guildId
        );

      if (
        mode === "off"
      ) {
        config.enabled =
          false;

        saveAll();

        await interaction
          .reply({
            content:
              "Auto logs have been completely disabled.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      await interaction
        .deferReply({
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      const created =
        await createAutoLogs(
          interaction.guild
        );

      if (!created) {
        await interaction
          .editReply({
            content:
              "I couldn't create the LOGS category/channels. Check my Manage Channels permission.",
          })
          .catch(
            () => {}
          );

        return;
      }

      await interaction
        .editReply({
          content:
            "Auto logs are now enabled. I created/used the LOGS category and the logging channels.",
        })
        .catch(
          () => {}
        );

      return;
    }
  }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);