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

const REP_COMMAND_COOLDOWN_MS = 3000;
const GOODREP_COOLDOWN_MS = 5 * 60 * 1000;
const BADREP_COOLDOWN_MS = 7 * 60 * 1000;
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

function saveAll() {
  save(LEVELS_FILE, levels);
  save(ANNOUNCEMENTS_FILE, announcements);
  save(SETTINGS_FILE, settings);
  save(REPUTATION_FILE, reputation);
  save(COMMENTS_FILE, comments);
}

/* =========================================================
   GUILD SETTINGS
========================================================= */

function getGuildSettings(guildId) {
  if (!settings[guildId]) {
    settings[guildId] = {
      /*
        XP system.

        Global:
        xpEnabled = true/false

        Channel overrides:
        xpChannelStates[channelId] = true/false

        This allows:
        /xp-statue on
        /xp-statue off
        /xp-statue on #channel
        /xp-statue off #channel
      */

      xpEnabled: false,
      xpChannelStates: {},

      /*
        Anti-spam.

        Global:
        antispamEnabled = true/false

        Channel overrides:
        antispamChannelStates[channelId] = true/false
      */

      antispamEnabled: true,
      antispamChannelStates: {},

      levelChannelId: null,
    };
  }

  /*
    Backwards compatibility for older settings.json files.
  */

  if (
    typeof settings[guildId].xpEnabled !==
    "boolean"
  ) {
    settings[guildId].xpEnabled = false;
  }

  if (
    !settings[guildId].xpChannelStates ||
    typeof settings[guildId].xpChannelStates !==
      "object"
  ) {
    settings[guildId].xpChannelStates = {};
  }

  if (
    typeof settings[guildId].antispamEnabled !==
    "boolean"
  ) {
    settings[guildId].antispamEnabled = true;
  }

  if (
    !settings[guildId].antispamChannelStates ||
    typeof settings[guildId].antispamChannelStates !==
      "object"
  ) {
    settings[guildId].antispamChannelStates = {};
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      settings[guildId],
      "levelChannelId"
    )
  ) {
    settings[guildId].levelChannelId = null;
  }

  return settings[guildId];
}

/* =========================================================
   FEATURE STATE
========================================================= */

function isXPEnabled(
  guildSettings,
  channelId
) {
  if (
    Object.prototype.hasOwnProperty.call(
      guildSettings.xpChannelStates,
      channelId
    )
  ) {
    return Boolean(
      guildSettings.xpChannelStates[channelId]
    );
  }

  return Boolean(
    guildSettings.xpEnabled
  );
}

function isAntiSpamEnabled(
  guildSettings,
  channelId
) {
  if (
    Object.prototype.hasOwnProperty.call(
      guildSettings.antispamChannelStates,
      channelId
    )
  ) {
    return Boolean(
      guildSettings.antispamChannelStates[channelId]
    );
  }

  return Boolean(
    guildSettings.antispamEnabled
  );
}

/* =========================================================
   ADMIN CHECK
========================================================= */

function isAdmin(member) {
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
   LEVEL USER
========================================================= */

function getUser(
  guildId,
  userId
) {
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

function getReputation(
  guildId,
  userId
) {
  if (!reputation[guildId]) {
    reputation[guildId] = {};
  }

  if (
    typeof reputation[guildId][userId] !==
    "number"
  ) {
    reputation[guildId][userId] = 0;
  }

  return reputation[guildId][userId];
}

function addReputation(
  guildId,
  userId,
  amount
) {
  const current =
    getReputation(
      guildId,
      userId
    );

  reputation[guildId][userId] =
    Number(
      (current + amount).toFixed(2)
    );

  return reputation[guildId][userId];
}

function getTopReputation(
  guildId
) {
  return Object.entries(
    reputation[guildId] || {}
  )
    .filter(
      ([, value]) =>
        typeof value === "number"
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

  if (!Array.isArray(
    comments[guildId][userId]
  )) {
    comments[guildId][userId] = [];
  }

  return comments[guildId][userId];
}

function addComment(
  guildId,
  userId,
  text
) {
  const userComments =
    getUserComments(
      guildId,
      userId
    );

  /*
    IMPORTANT:

    We deliberately DO NOT save:
    - author ID
    - author username
    - author tag

    This keeps the impression anonymous.
  */

  userComments.push({
    id:
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`,
    text,
    createdAt:
      new Date().toISOString(),
  });

  return userComments[
    userComments.length - 1
  ];
}

/* =========================================================
   SPAM MEMORY
========================================================= */

const spamTracker = new Map();
const spamActionLock = new Map();
const spamStrikes = new Map();

/* =========================================================
   COMMAND COOLDOWNS
========================================================= */

const commandCooldowns =
  new Map();

const specialCooldowns =
  new Map();

const COMMANDS_WITHOUT_COOLDOWN =
  new Set([]);

/* =========================================================
   COMMAND COOLDOWN CHECK
========================================================= */

function checkCommandCooldown(
  interaction
) {
  if (
    COMMANDS_WITHOUT_COOLDOWN.has(
      interaction.commandName
    )
  ) {
    return 0;
  }

  const key =
    `${interaction.guild.id}:${interaction.user.id}:${interaction.commandName}`;

  const now = Date.now();

  const last =
    commandCooldowns.get(key) || 0;

  const remaining =
    COMMAND_COOLDOWN_MS -
    (now - last);

  if (remaining > 0) {
    return remaining;
  }

  commandCooldowns.set(
    key,
    now
  );

  return 0;
}

function checkSpecialCooldown(
  interaction,
  cooldownMs
) {
  const key =
    `${interaction.guild.id}:${interaction.user.id}:${interaction.commandName}`;

  const now = Date.now();

  const last =
    specialCooldowns.get(key) || 0;

  const remaining =
    cooldownMs -
    (now - last);

  if (remaining > 0) {
    return remaining;
  }

  specialCooldowns.set(
    key,
    now
  );

  return 0;
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

function clearSpamTracker(
  key
) {
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
   SPAM DETECTION
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

  let messages =
    spamTracker.get(key) || [];

  messages =
    messages.filter(
      (entry) =>
        now - entry.timestamp <=
        SPAM_WINDOW_MS
    );

  messages.push({
    timestamp: now,
    message,
  });

  spamTracker.set(
    key,
    messages
  );

  return messages;
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
    !isAntiSpamEnabled(
      guildSettings,
      message.channel.id
    )
  ) {
    return false;
  }

  /*
    Moderators / admins are immune.
  */

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

  const messages =
    registerSpamMessage(
      message
    );

  /*
    More than 3 messages in less than 5 seconds.

    When the 4th message arrives:
    delete the FIRST message.

    When the 5th arrives:
    delete the next oldest message.

    And so on.

    This means the system continuously removes
    the oldest message once the user exceeds
    the 3-message limit.
  */

  if (
    messages.length <=
    SPAM_MESSAGE_LIMIT
  ) {
    return false;
  }

  const oldest =
    messages.shift();

  spamTracker.set(
    key,
    messages
  );

  if (oldest?.message) {
    await oldest.message
      .delete()
      .catch(
        () => {}
      );
  }

  if (isSpamLocked(key)) {
    return true;
  }

  spamActionLock.set(
    key,
    Date.now() +
      SPAM_ACTION_DELAY_MS
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

  /*
    Check moderator again.
  */

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
   SLASH COMMANDS
========================================================= */

const commands = [
  /* =========================
     /level
  ========================= */

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

  /* =========================
     /top
  ========================= */

  new SlashCommandBuilder()
    .setName("top")
    .setDescription(
      "Show the top 100 members by XP"
    ),

  /* =========================
     /top-xp
     Legacy command
  ========================= */

  new SlashCommandBuilder()
    .setName("top-xp")
    .setDescription(
      "Show the top 100 members by XP"
    ),

  /* =========================
     /xp-annc
  ========================= */

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
            "Channel where announcement will be sent"
          )
          .setRequired(false)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
    ),

  /* =========================
     /xp-statue
  ========================= */

  new SlashCommandBuilder()
    .setName("xp-statue")
    .setDescription(
      "Turn XP system on/off globally or for a specific channel"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
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
            "Optional channel to apply this setting to"
          )
          .setRequired(false)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
    ),

  /* =========================
     /antispam-statue
  ========================= */

  new SlashCommandBuilder()
    .setName("antispam-statue")
    .setDescription(
      "Turn anti-spam on/off globally or for a specific channel"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
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
            "Optional channel to apply this setting to"
          )
          .setRequired(false)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
    ),

  /* =========================
     /spam
     Legacy command
  ========================= */

  new SlashCommandBuilder()
    .setName("spam")
    .setDescription(
      "Legacy anti-spam control"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
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
    ),

  /* =========================
     /level-channel
  ========================= */

  new SlashCommandBuilder()
    .setName("level-channel")
    .setDescription(
      "Set the channel where level-up messages are sent"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
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

  /* =========================
     /vafk
  ========================= */

  new SlashCommandBuilder()
    .setName("vafk")
    .setDescription(
      "Join a voice channel and stay AFK"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addChannelOption(
      (option) =>
        option
          .setName("channel")
          .setDescription(
            "Voice channel where the bot should stay AFK"
          )
          .setRequired(true)
          .addChannelTypes(
            ChannelType.GuildVoice,
            ChannelType.GuildStageVoice
          )
    ),

  /* =========================
     /rep
  ========================= */

  new SlashCommandBuilder()
    .setName("rep")
    .setDescription(
      "Show your reputation or another member's reputation"
    )
    .addUserOption(
      (option) =>
        option
          .setName("member")
          .setDescription(
            "Member whose reputation you want to see"
          )
          .setRequired(false)
    ),

  /* =========================
     /goodrep-add
  ========================= */

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

  /* =========================
     /badrep-add
  ========================= */

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

  /* =========================
     /top-rep
  ========================= */

  new SlashCommandBuilder()
    .setName("top-rep")
    .setDescription(
      "Show the top 100 members by reputation"
    ),

  /* =========================
     /comment
  ========================= */

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
            "Member you want to send the impression to"
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

  /* =========================
     /view-comments
  ========================= */

  new SlashCommandBuilder()
    .setName("view-comments")
    .setDescription(
      "View the anonymous impressions people have left for you"
    )
    .addBooleanOption(
      (option) =>
        option
          .setName("hidden")
          .setDescription(
            "If true, only you can see the comments"
          )
          .setRequired(false)
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

  /vafk is MANUAL.

  The bot joins only when /vafk is used.

  If the bot is kicked/disconnected:
  - it does NOT reconnect automatically
  - it does NOT retry
  - it does NOT move back
  - /vafk must be used again

  If the channel is deleted:
  - the connection is destroyed
  - the bot does NOT attempt to find another channel
  - /vafk must be used again
*/

let afkVoiceConnection = null;
let afkVoiceChannelId = null;

async function joinVAFKVoice(
  channel
) {
  if (!channel) {
    return false;
  }

  if (
    channel.type !==
      ChannelType.GuildVoice &&
    channel.type !==
      ChannelType.GuildStageVoice
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

    afkVoiceConnection =
      connection;

    afkVoiceChannelId =
      channel.id;

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

        /*
          Do NOT reconnect.

          If Discord disconnects the bot,
          destroy the connection and wait for
          another /vafk command.
        */

        if (
          newState.status ===
          "disconnected"
        ) {
          try {
            connection.destroy();
          } catch {
            // Ignore destroy errors.
          }

          if (
            afkVoiceConnection ===
            connection
          ) {
            afkVoiceConnection =
              null;

            afkVoiceChannelId =
              null;
          }

          console.log(
            "VAFK connection ended. The bot will NOT reconnect until /vafk is used again."
          );
        }
      }
    );

    console.log(
      `Joined VAFK voice channel: ${channel.name}`
    );

    return true;
  } catch (error) {
    console.error(
      "Failed to join VAFK voice:",
      error
    );

    return false;
  }
}

/* =========================================================
   LEVEL ANNOUNCEMENT BUILDER
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
   TOP REP BUILDER
========================================================= */

async function buildTopReputation(
  guildId,
  page = 0
) {
  const top =
    getTopReputation(
      guildId
    );

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

  const guild =
    client.guilds.cache.get(
      guildId
    );

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

    const formattedRep =
      Number(rep).toFixed(2);

    rows.push(
      `**#${start + i + 1}** ${name} • **${formattedRep} Rep**`
    );
  }

  const embed =
    new EmbedBuilder()
      .setColor(
        0x00d4ff
      )
      .setTitle(
        "Top 100 Reputation"
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
   COMMENTS BUILDER
========================================================= */

function buildCommentsPage(
  guildId,
  userId,
  page = 0
) {
  const userComments =
    getUserComments(
      guildId,
      userId
    );

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        userComments.length / 5
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
    safePage * 5;

  const pageComments =
    userComments.slice(
      start,
      start + 5
    );

  const description =
    pageComments.length
      ? pageComments
          .map(
            (comment, index) => {
              const number =
                start +
                index +
                1;

              const date =
                new Date(
                  comment.createdAt
                );

              const dateText =
                Number.isNaN(
                  date.getTime()
                )
                  ? ""
                  : ` • <t:${Math.floor(
                      date.getTime() / 1000
                    )}:R>`;

              return (
                `**#${number}**${dateText}\n` +
                `${comment.text}`
              );
            }
          )
          .join("\n\n")
      : "You don't have any comments yet.";

  const embed =
    new EmbedBuilder()
      .setColor(
        0x00d4ff
      )
      .setTitle(
        "Your anonymous impressions"
      )
      .setDescription(
        description
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
            `comments_prev_${guildId}_${userId}_${safePage}`
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
            `comments_next_${guildId}_${userId}_${safePage}`
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
       XP STATE
    ===================================================== */

    if (
      !isXPEnabled(
        guildSettings,
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

    /*
      Save old level BEFORE XP.
    */

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
       CALCULATE NEW LEVEL
    ===================================================== */

    const newLevel =
      calculateLevel(
        user.xp
      );

    user.level =
      newLevel;

    /* =====================================================
       SAVE BEFORE LEVEL-UP MESSAGE
    ===================================================== */

    saveAll();

    /* =====================================================
       LEVEL UP
    ===================================================== */

    if (
      newLevel <= oldLevel
    ) {
      return;
    }

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
      /* ===================================================
         XP PAGINATION
      =================================================== */

      if (
        interaction.customId.startsWith(
          "xp_"
        )
      ) {
        const parts =
          interaction.customId.split(
            "_"
          );

        if (
          parts.length < 4
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

      /* ===================================================
         REP PAGINATION
      =================================================== */

      if (
        interaction.customId.startsWith(
          "rep_"
        )
      ) {
        const parts =
          interaction.customId.split(
            "_"
          );

        if (
          parts.length < 3
        ) {
          return;
        }

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
          await buildTopReputation(
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

      /* ===================================================
         COMMENTS PAGINATION
      =================================================== */

      if (
        interaction.customId.startsWith(
          "comments_"
        )
      ) {
        const parts =
          interaction.customId.split(
            "_"
          );

        if (
          parts.length < 5
        ) {
          return;
        }

        const direction =
          parts[1];

        const guildIdFromButton =
          parts[2];

        const targetUserId =
          parts[3];

        const currentPage =
          Number(
            parts[4]
          ) || 0;

        if (
          guildIdFromButton !==
          interaction.guild.id
        ) {
          return;
        }

        const userComments =
          getUserComments(
            guildIdFromButton,
            targetUserId
          );

        const totalPages =
          Math.max(
            1,
            Math.ceil(
              userComments.length / 5
            )
          );

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
          buildCommentsPage(
            guildIdFromButton,
            targetUserId,
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

    /* =====================================================
       ADMIN COMMAND CHECK
    ===================================================== */

    const adminCommands =
      new Set([
        "xp-annc",
        "xp-statue",
        "antispam-statue",
        "spam",
        "level-channel",
        "vafk",
      ]);

    if (
      adminCommands.has(
        interaction.commandName
      ) &&
      !isAdmin(
        interaction.member
      )
    ) {
      await interaction
        .reply({
          content:
            "You need administrator/Manage Server permission to use this command.",
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       SPECIAL COOLDOWNS
    ===================================================== */

    const specialCooldownMap = {
      rep:
        REP_COMMAND_COOLDOWN_MS,

      "goodrep-add":
        GOODREP_COOLDOWN_MS,

      "badrep-add":
        BADREP_COOLDOWN_MS,

      "top-rep":
        TOP_REP_COOLDOWN_MS,

      comment:
        COMMENT_COOLDOWN_MS,
    };

    if (
      Object.prototype.hasOwnProperty.call(
        specialCooldownMap,
        interaction.commandName
      )
    ) {
      const remaining =
        checkSpecialCooldown(
          interaction,
          specialCooldownMap[
            interaction.commandName
          ]
        );

      if (remaining > 0) {
        const seconds =
          Math.ceil(
            remaining / 1000
          );

        await interaction
          .reply({
            content:
              `Please wait ${seconds} second(s) before using this command again.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }
    } else {
      /* ===================================================
         NORMAL COMMAND COOLDOWN
      =================================================== */

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
       /TOP-XP
    ===================================================== */

    if (
      interaction.commandName ===
        "top" ||
      interaction.commandName ===
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
      interaction.commandName ===
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
      interaction.commandName ===
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

      const enabled =
        mode === "on";

      if (channel) {
        guildSettings.xpChannelStates[
          channel.id
        ] = enabled;

        saveAll();

        await interaction
          .reply({
            content:
              enabled
                ? `XP is now enabled in ${channel}.`
                : `XP is now disabled in ${channel}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      guildSettings.xpEnabled =
        enabled;

      /*
        When changing global state,
        clear channel overrides so the global
        state becomes the clear source of truth.
      */

      guildSettings.xpChannelStates =
        {};

      saveAll();

      await interaction
        .reply({
          content:
            enabled
              ? "XP system is now enabled globally."
              : "XP system is now disabled globally.",
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /ANTISPAM-STATUE
       /SPAM LEGACY
    ===================================================== */

    if (
      interaction.commandName ===
        "antispam-statue" ||
      interaction.commandName ===
        "spam"
    ) {
      const mode =
        interaction.options.getString(
          "mode",
          true
        );

      const channel =
        interaction.commandName ===
        "antispam-statue"
          ? interaction.options.getChannel(
              "channel"
            )
          : null;

      const enabled =
        mode === "on";

      if (channel) {
        guildSettings.antispamChannelStates[
          channel.id
        ] = enabled;

        /*
          Clear spam memory for this channel
          when disabling it.
        */

        if (!enabled) {
          for (
            const [
              key,
              entries,
            ] of spamTracker.entries()
          ) {
            const filtered =
              entries.filter(
                (entry) =>
                  entry.message
                    ?.channel?.id !==
                  channel.id
              );

            if (
              filtered.length
            ) {
              spamTracker.set(
                key,
                filtered
              );
            } else {
              spamTracker.delete(
                key
              );
            }
          }
        }

        saveAll();

        await interaction
          .reply({
            content:
              enabled
                ? `Anti-spam is now enabled in ${channel}.`
                : `Anti-spam is now disabled in ${channel}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      guildSettings.antispamEnabled =
        enabled;

      /*
        No channel means global control.
      */

      guildSettings.antispamChannelStates =
        {};

      if (!enabled) {
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
      }

      saveAll();

      await interaction
        .reply({
          content:
            enabled
              ? "Anti-spam is now enabled globally."
              : "Anti-spam is now completely disabled globally.",
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
      interaction.commandName ===
      "vafk"
    ) {
      const channel =
        interaction.options.getChannel(
          "channel",
          true
        );

      if (
        channel.type !==
          ChannelType.GuildVoice &&
        channel.type !==
          ChannelType.GuildStageVoice
      ) {
        await interaction
          .reply({
            content:
              "Please select a valid voice channel.",
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
        !botMember
      ) {
        await interaction
          .reply({
            content:
              "I couldn't find my member information in this server.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const permissions =
        channel.permissionsFor(
          botMember
        );

      if (
        !permissions?.has(
          PermissionFlagsBits.Connect
        )
      ) {
        await interaction
          .reply({
            content:
              "I don't have permission to connect to that voice channel.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      if (
        !permissions?.has(
          PermissionFlagsBits.Speak
        )
      ) {
        /*
          Speak isn't technically needed because
          the bot is self-muted, so this is intentionally
          NOT treated as a blocker.
        */
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
            `I'm now AFK in ${channel}. If I get kicked/disconnected, I will NOT return until /vafk is used again.`,
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
              "That member isn't in this server.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const rep =
        getReputation(
          guildId,
          target.id
        );

      const embed =
        new EmbedBuilder()
          .setColor(
            0x00d4ff
          )
          .setAuthor({
            name:
              `${member.displayName}'s reputation`,
            iconURL:
              target.displayAvatarURL(),
          })
          .setDescription(
            `**${Number(rep).toFixed(2)} Reputation**`
          )
          .setThumbnail(
            target.displayAvatarURL()
          )
          .setFooter({
            text:
              "Reputation is server-specific.",
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
              "That member isn't in this server.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const newRep =
        addReputation(
          guildId,
          target.id,
          1
        );

      saveAll();

      await interaction
        .reply({
          content:
            `Added **+1.00 Rep** to ${target}. Their reputation is now **${newRep.toFixed(2)}**.`,
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
              "That member isn't in this server.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      const newRep =
        addReputation(
          guildId,
          target.id,
          -0.5
        );

      saveAll();

      await interaction
        .reply({
          content:
            `Added **-0.50 Rep** to ${target}. Their reputation is now **${newRep.toFixed(2)}**.`,
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
      const top =
        await buildTopReputation(
          guildId,
          0
        );

      await interaction
        .reply(top)
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
      const target =
        interaction.options.getUser(
          "member",
          true
        );

      const text =
        interaction.options.getString(
          "text",
          true
        ).trim();

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
              "That member isn't in this server.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      if (!text) {
        await interaction
          .reply({
            content:
              "Your impression cannot be empty.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      /*
        Send DM first.

        We only save the comment if the DM
        was successfully delivered.
      */

      try {
        await target.send({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x00d4ff
              )
              .setTitle(
                "You received an anonymous impression"
              )
              .setDescription(
                text
              )
              .setFooter({
                text:
                  `From ${interaction.guild.name}`,
              })
              .setTimestamp(),
          ],
        });
      } catch (error) {
        await interaction
          .reply({
            content:
              "I couldn't send the impression because I can't DM that member.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      addComment(
        guildId,
        target.id,
        text
      );

      saveAll();

      await interaction
        .reply({
          content:
            `Your anonymous impression was sent to ${target}.`,
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
        interaction.options.getBoolean(
          "hidden"
        ) ?? false;

      const result =
        buildCommentsPage(
          guildId,
          interaction.user.id,
          0
        );

      await interaction
        .reply({
          ...result,
          ephemeral: hidden,
        })
        .catch(
          () => {}
        );

      return;
    }
  }
);

/* =========================================================
   CLIENT READY
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

    /*
      IMPORTANT:

      There is intentionally NO automatic VAFK
      join here.

      /vafk must always be manually used.
    */
  }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);