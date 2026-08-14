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
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

const fs = require("node:fs");
const path = require("node:path");

/* =========================================================
   ENV
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

/* =========================================================
   DATA
========================================================= */

const DATA_DIR = path.join(__dirname, "..", "data");

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

fs.mkdirSync(DATA_DIR, {
  recursive: true,
});

function load(file, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
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

function saveAll() {
  save(
    LEVELS_FILE,
    levels
  );

  save(
    ANNOUNCEMENTS_FILE,
    announcements
  );

  save(
    SETTINGS_FILE,
    settings
  );
}

/* =========================================================
   DEFAULT GUILD SETTINGS
========================================================= */

function getGuildSettings(guildId) {
  if (!settings[guildId]) {
    settings[guildId] = {
      spamEnabled: true,

      spamExcludedChannels: [],

      levelUpChannelId: null,

      afkVoiceChannelId: null,

      spamHistory: {},

      spamPunishments: {},
    };
  }

  if (
    typeof settings[guildId].spamEnabled !==
    "boolean"
  ) {
    settings[guildId].spamEnabled = true;
  }

  if (
    !Array.isArray(
      settings[guildId]
        .spamExcludedChannels
    )
  ) {
    settings[guildId]
      .spamExcludedChannels = [];
  }

  if (
    !settings[guildId].spamHistory
  ) {
    settings[guildId].spamHistory = {};
  }

  if (
    !settings[guildId]
      .spamPunishments
  ) {
    settings[guildId]
      .spamPunishments = {};
  }

  return settings[guildId];
}

/* =========================================================
   LEVEL SYSTEM
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

/*
  Level 0 = 0 XP
  Level 1 = 100 XP
  Level 2 = 282 XP
  Level 3 = 519 XP
  etc.
*/

function xpForLevel(level) {
  return Math.floor(
    100 * Math.pow(level, 1.5)
  );
}

function calculateLevel(xp) {
  let level = 0;

  while (
    xp >=
    xpForLevel(level + 1)
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

  const filled = Math.floor(
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

/* =========================================================
   COMMAND COOLDOWN
========================================================= */

const commandCooldowns =
  new Map();

const DEFAULT_COMMAND_COOLDOWN =
  2000;

const COMMAND_COOLDOWNS = {
  level: 2000,
  "top-xp": 2000,
  "xp-annc": 2000,
  "spam-control": 2000,
  "spam-channel": 2000,
  "level-channel": 2000,
  "afk-voice": 3000,
};

/*
  لاحقًا إذا أردت استثناء أمر من الـ cooldown
  نضعه هنا بقيمة 0.
*/

function getCommandCooldown(
  commandName
) {
  if (
    Object.prototype.hasOwnProperty.call(
      COMMAND_COOLDOWNS,
      commandName
    )
  ) {
    return COMMAND_COOLDOWNS[
      commandName
    ];
  }

  return DEFAULT_COMMAND_COOLDOWN;
}

function isCommandOnCooldown(
  interaction
) {
  const cooldown =
    getCommandCooldown(
      interaction.commandName
    );

  if (cooldown <= 0) {
    return {
      onCooldown: false,
      remaining: 0,
    };
  }

  const key =
    `${interaction.guildId}:${interaction.user.id}:${interaction.commandName}`;

  const now = Date.now();

  const lastUsed =
    commandCooldowns.get(key) || 0;

  const remaining =
    cooldown -
    (now - lastUsed);

  if (remaining > 0) {
    return {
      onCooldown: true,
      remaining,
    };
  }

  commandCooldowns.set(
    key,
    now
  );

  return {
    onCooldown: false,
    remaining: 0,
  };
}

/* =========================================================
   SLASH COMMANDS
========================================================= */

const commands = [

  /* =========================
     LEVEL
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
     TOP XP
  ========================= */

  new SlashCommandBuilder()
    .setName("top-xp")
    .setDescription(
      "Show the top 100 members by XP"
    ),

  /* =========================
     XP ANNOUNCEMENT
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
            "Channel where the announcement will be sent"
          )
          .addChannelTypes(
            ChannelType.GuildText
          )
          .setRequired(false)
    ),

  /* =========================
     SPAM CONTROL
  ========================= */

  new SlashCommandBuilder()
    .setName("spam-control")
    .setDescription(
      "Turn anti-spam protection on or off"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(
      (option) =>
        option
          .setName("status")
          .setDescription(
            "Enable or disable anti-spam"
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
     SPAM EXCLUDED CHANNEL
  ========================= */

  new SlashCommandBuilder()
    .setName("spam-channel")
    .setDescription(
      "Configure a channel where anti-spam is ignored"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(
      (option) =>
        option
          .setName("action")
          .setDescription(
            "Add, remove, or clear excluded channels"
          )
          .setRequired(true)
          .addChoices(
            {
              name: "Add",
              value: "add",
            },
            {
              name: "Remove",
              value: "remove",
            },
            {
              name: "Clear All",
              value: "clear",
            }
          )
    )
    .addChannelOption(
      (option) =>
        option
          .setName("channel")
          .setDescription(
            "Channel to add/remove"
          )
          .addChannelTypes(
            ChannelType.GuildText
          )
          .setRequired(false)
    ),

  /* =========================
     LEVEL UP CHANNEL
  ========================= */

  new SlashCommandBuilder()
    .setName("level-channel")
    .setDescription(
      "Set the channel for level-up messages"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(
      (option) =>
        option
          .setName("action")
          .setDescription(
            "Set or disable the level-up channel"
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
            "Channel for level-up messages"
          )
          .addChannelTypes(
            ChannelType.GuildText
          )
          .setRequired(false)
    ),

  /* =========================
     AFK VOICE
  ========================= */

  new SlashCommandBuilder()
    .setName("afk-voice")
    .setDescription(
      "Configure the 24/7 AFK voice channel"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(
      (option) =>
        option
          .setName("action")
          .setDescription(
            "Join or leave the AFK voice channel"
          )
          .setRequired(true)
          .addChoices(
            {
              name: "Set / Join",
              value: "set",
            },
            {
              name: "Off / Leave",
              value: "off",
            }
          )
    )
    .addChannelOption(
      (option) =>
        option
          .setName("channel")
          .setDescription(
            "Voice channel to stay in 24/7"
          )
          .addChannelTypes(
            ChannelType.GuildVoice,
            ChannelType.GuildStageVoice
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
   AFK VOICE 24/7
========================================================= */

const afkReconnectTimers =
  new Map();

async function joinAfkVoice(
  guild,
  channelId
) {
  const channel =
    guild.channels.cache.get(
      channelId
    );

  if (
    !channel ||
    !channel.isVoiceBased()
  ) {
    console.error(
      `AFK voice channel not found for guild ${guild.id}`
    );

    return false;
  }

  try {
    const oldConnection =
      getVoiceConnection(
        guild.id
      );

    if (oldConnection) {
      try {
        oldConnection.destroy();
      } catch {}
    }

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

    connection.on(
      VoiceConnectionStatus.Ready,
      () => {
        console.log(
          `AFK voice connected: ${guild.name}`
        );
      }
    );

    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        console.log(
          `AFK voice disconnected: ${guild.name}`
        );

        try {
          await Promise.race([
            entersState(
              connection,
              VoiceConnectionStatus.Signalling,
              5000
            ),

            entersState(
              connection,
              VoiceConnectionStatus.Connecting,
              5000
            ),
          ]);

          console.log(
            `AFK voice recovered: ${guild.name}`
          );
        } catch {
          try {
            connection.destroy();
          } catch {}

          scheduleAfkReconnect(
            guild.id
          );
        }
      }
    );

    connection.on(
      VoiceConnectionStatus.Destroyed,
      () => {
        const config =
          getGuildSettings(
            guild.id
          );

        if (
          config.afkVoiceChannelId
        ) {
          scheduleAfkReconnect(
            guild.id
          );
        }
      }
    );

    return true;
  } catch (error) {
    console.error(
      `Failed to join AFK voice in ${guild.name}:`,
      error
    );

    scheduleAfkReconnect(
      guild.id
    );

    return false;
  }
}

function scheduleAfkReconnect(
  guildId
) {
  if (
    afkReconnectTimers.has(
      guildId
    )
  ) {
    return;
  }

  const timer =
    setTimeout(
      async () => {
        afkReconnectTimers.delete(
          guildId
        );

        const guild =
          client.guilds.cache.get(
            guildId
          );

        if (!guild) {
          return;
        }

        const config =
          getGuildSettings(
            guildId
          );

        if (
          !config.afkVoiceChannelId
        ) {
          return;
        }

        await joinAfkVoice(
          guild,
          config.afkVoiceChannelId
        );
      },
      5000
    );

  afkReconnectTimers.set(
    guildId,
    timer
  );
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

    /* =========================
       RECONNECT AFK VOICES
    ========================= */

    for (
      const guild of bot.guilds.cache.values()
    ) {
      const config =
        getGuildSettings(
          guild.id
        );

      if (
        config.afkVoiceChannelId
      ) {
        setTimeout(
          () => {
            joinAfkVoice(
              guild,
              config.afkVoiceChannelId
            );
          },
          2000
        );
      }
    }

    saveAll();
  }
);

/* =========================================================
   SPAM SYSTEM
========================================================= */

const SPAM_MESSAGE_LIMIT = 5;

const SPAM_WINDOW_MS = 3000;

const FIRST_TIMEOUT_MS =
  5 * 60 * 1000;

const SECOND_TIMEOUT_MS =
  20 * 60 * 1000;

const SPAM_WARNING_DELETE_MS =
  2000;

const spamWarningTimers =
  new Map();

function isModerator(
  member
) {
  if (!member) {
    return false;
  }

  return member.permissions.has(
    PermissionFlagsBits.ModerateMembers
  );
}

function isSpamExcludedChannel(
  guildId,
  channelId
) {
  const config =
    getGuildSettings(
      guildId
    );

  return config
    .spamExcludedChannels
    .includes(channelId);
}

function cleanupSpamHistory(
  history
) {
  const now =
    Date.now();

  return history.filter(
    (timestamp) =>
      now - timestamp <=
      SPAM_WINDOW_MS
  );
}

function registerSpamMessage(
  guildId,
  userId
) {
  const config =
    getGuildSettings(
      guildId
    );

  if (
    !config.spamHistory[userId]
  ) {
    config.spamHistory[userId] = [];
  }

  config.spamHistory[userId] =
    cleanupSpamHistory(
      config.spamHistory[userId]
    );

  config.spamHistory[userId].push(
    Date.now()
  );

  return (
    config.spamHistory[userId]
      .length >
    SPAM_MESSAGE_LIMIT
  );
}

function getSpamPunishment(
  guildId,
  userId
) {
  const config =
    getGuildSettings(
      guildId
    );

  if (
    !config.spamPunishments[userId]
  ) {
    config.spamPunishments[userId] = {
      violations: 0,
      lastViolation: 0,
    };
  }

  return config
    .spamPunishments[userId];
}

function clearSpamHistory(
  guildId,
  userId
) {
  const config =
    getGuildSettings(
      guildId
    );

  config.spamHistory[userId] = [];
}

function getTimeoutDuration(
  guildId,
  userId
) {
  const punishment =
    getSpamPunishment(
      guildId,
      userId
    );

  /*
    إذا كان عنده مخالفة سابقة
    وأخذ timeout قبل، المرة التالية = 20 دقيقة.
  */

  if (
    punishment.violations >= 1
  ) {
    return SECOND_TIMEOUT_MS;
  }

  return FIRST_TIMEOUT_MS;
}

async function sendSpamWarning(
  message,
  duration
) {
  const content =
    duration ===
    SECOND_TIMEOUT_MS
      ? "again? hope you enjoy the 20 min!"
      : "oops! seems like you send a lot of messages in a short time👀";

  try {
    const warning =
      await message.channel.send({
        content,
      });

    const timerKey =
      warning.id;

    const timer =
      setTimeout(
        async () => {
          spamWarningTimers.delete(
            timerKey
          );

          await warning
            .delete()
            .catch(() => {});
        },
        SPAM_WARNING_DELETE_MS
      );

    spamWarningTimers.set(
      timerKey,
      timer
    );
  } catch {}
}

async function applySpamTimeout(
  message
) {
  if (!message.guild) {
    return false;
  }

  const member =
    message.member ||
    await message.guild.members
      .fetch(
        message.author.id
      )
      .catch(() => null);

  if (!member) {
    return false;
  }

  /*
    المودريترز لا يأخذون timeout.
  */

  if (
    isModerator(member)
  ) {
    clearSpamHistory(
      message.guild.id,
      message.author.id
    );

    return false;
  }

  /*
    البوت لا يحاول يعطي timeout
    لأحد أعلى منه أو للبوت نفسه.
  */

  if (
    !member.moderatable
  ) {
    clearSpamHistory(
      message.guild.id,
      message.author.id
    );

    return false;
  }

  const guildId =
    message.guild.id;

  const userId =
    message.author.id;

  const duration =
    getTimeoutDuration(
      guildId,
      userId
    );

  const punishment =
    getSpamPunishment(
      guildId,
      userId
    );

  /*
    نسجل المخالفة قبل تنفيذ الـ timeout.
  */

  punishment.violations += 1;

  punishment.lastViolation =
    Date.now();

  /*
    نمسح التاريخ مباشرة حتى لا يحصل
    timeout مزدوج بسبب تأخير أو رسائل
    قادمة في نفس اللحظة.
  */

  clearSpamHistory(
    guildId,
    userId
  );

  saveAll();

  try {
    await member.timeout(
      duration,
      "Anti-spam protection"
    );
  } catch (error) {
    console.error(
      "Failed to timeout spammer:",
      error
    );

    return false;
  }

  await sendSpamWarning(
    message,
    duration
  );

  return true;
}

/* =========================================================
   MESSAGE XP + ANTI SPAM
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

    const guildId =
      message.guild.id;

    const userId =
      message.author.id;

    const config =
      getGuildSettings(
        guildId
      );

    /* =====================================================
       ANTI SPAM
    ===================================================== */

    if (
      config.spamEnabled &&
      !isSpamExcludedChannel(
        guildId,
        message.channel.id
      )
    ) {
      const member =
        message.member ||
        await message.guild.members
          .fetch(userId)
          .catch(() => null);

      /*
        المودريتر لا يدخل في نظام الـ spam.
      */

      if (
        !isModerator(member)
      ) {
        const spamDetected =
          registerSpamMessage(
            guildId,
            userId
          );

        if (spamDetected) {
          /*
            نوقف معالجة الرسالة فورًا.
            لذلك لا XP ولا Messages.
          */

          await applySpamTimeout(
            message
          );

          return;
        }
      } else {
        /*
          لا نحتفظ بتاريخ سبام للمودريتر.
        */

        clearSpamHistory(
          guildId,
          userId
        );
      }
    }

    /* =====================================================
       LEVEL XP
    ===================================================== */

    const user =
      getUser(
        guildId,
        userId
      );

    const oldLevel =
      user.level;

    const words =
      message.content
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!words.length) {
      return;
    }

    /*
      Normal XP:
      1 - 10 XP per word.
    */

    let xpPerWord =
      Math.floor(
        Math.random() * 10
      ) + 1;

    /*
      13% chance:
      11 - 100 XP per word.
    */

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

    user.xp +=
      earnedXP;

    user.messages += 1;

    /*
      لا يوجد Level Skip.
      المستوى يتحدد فقط من XP.
    */

    user.level =
      calculateLevel(
        user.xp
      );

    saveAll();

    /* =====================================================
       LEVEL UP
    ===================================================== */

    if (
      user.level > oldLevel
    ) {
      await sendLevelUpMessage(
        message,
        user
      );
    }
  }
);

/* =========================================================
   LEVEL UP MESSAGE
========================================================= */

async function sendLevelUpMessage(
  message,
  user
) {
  const guildId =
    message.guild.id;

  const config =
    getGuildSettings(
      guildId
    );

  /*
    إذا لم يتم تحديد قناة Level Up
    لا نرسل أي شيء.
  */

  if (
    !config.levelUpChannelId
  ) {
    return;
  }

  const channel =
    message.guild.channels.cache.get(
      config.levelUpChannelId
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return;
  }

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
      .setColor(0x81c1eb)
      .setTitle(
        "you have levelled up! keep it up for a cookie 🍪!"
      )
      .setDescription(
        `${message.author} reached **Level ${user.level}**!`
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

  await channel
    .send({
      content:
        `${message.author}`,
      embeds: [embed],
    })
    .catch(() => {});
}

/* =========================================================
   TOP XP
========================================================= */

function getTopXP(
  guildId
) {
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
   ANNOUNCEMENT BUILDER
========================================================= */

async function buildAnnouncement(
  guildId,
  type,
  page = 0
) {
  const top =
    getTopXP(
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
    ] = pageUsers[i];

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
      .setColor(0x00d4ff)
      .setTitle(
        title
      )
      .setDescription(
        `**Top 100 members with most XP**\n\n` +
          (
            rows.length
              ? rows.join(
                  "\n"
                )
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
    embeds: [embed],
    components: [row],
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
      .send(
        announcement
      )
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
   INTERACTIONS
========================================================= */

client.on(
  Events.InteractionCreate,
  async (
    interaction
  ) => {

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
        !interaction.guild ||
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

    /* =====================================================
       SLASH COMMAND CHECK
    ===================================================== */

    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    if (
      !interaction.guild
    ) {
      return;
    }

    /* =====================================================
       COMMAND COOLDOWN
    ===================================================== */

    const cooldown =
      isCommandOnCooldown(
        interaction
      );

    if (
      cooldown.onCooldown
    ) {
      const seconds =
        Math.ceil(
          cooldown.remaining /
            1000
        );

      await interaction
        .reply({
          content:
            `Please wait **${seconds}s** before using this command again.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    const guildId =
      interaction.guild.id;

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
          .fetch(
            target.id
          )
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

      await interaction.reply({
        embeds: [embed],
      });

      return;
    }

    /* =====================================================
       /TOP-XP
    ===================================================== */

    if (
      interaction.commandName ===
      "top-xp"
    ) {
      const announcement =
        await buildAnnouncement(
          guildId,
          "daily",
          0
        );

      await interaction.reply(
        announcement
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

        await interaction.reply({
          content:
            "XP announcements are now disabled.",
          ephemeral: true,
        });

        return;
      }

      if (
        !channel ||
        !channel.isTextBased()
      ) {
        await interaction.reply({
          content:
            "Please select a text channel.",
          ephemeral: true,
        });

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

      await interaction.reply({
        content:
          `${type === "daily" ? "Daily" : "Weekly"} XP announcements are now enabled in ${channel}.`,
        ephemeral: true,
      });

      return;
    }

    /* =====================================================
       /SPAM-CONTROL
    ===================================================== */

    if (
      interaction.commandName ===
      "spam-control"
    ) {
      const status =
        interaction.options.getString(
          "status",
          true
        );

      const config =
        getGuildSettings(
          guildId
        );

      if (
        status === "on"
      ) {
        config.spamEnabled =
          true;

        saveAll();

        await interaction.reply({
          content:
            "Anti-spam is now **ON**.",
          ephemeral: true,
        });

        return;
      }

      if (
        status === "off"
      ) {
        config.spamEnabled =
          false;

        /*
          تنظيف الـ spam history
          عند الإطفاء.
        */

        config.spamHistory =
          {};

        saveAll();

        await interaction.reply({
          content:
            "Anti-spam is now **OFF**.",
          ephemeral: true,
        });

        return;
      }

      return;
    }

    /* =====================================================
       /SPAM-CHANNEL
    ===================================================== */

    if (
      interaction.commandName ===
      "spam-channel"
    ) {
      const action =
        interaction.options.getString(
          "action",
          true
        );

      const channel =
        interaction.options.getChannel(
          "channel"
        );

      const config =
        getGuildSettings(
          guildId
        );

      if (
        action === "clear"
      ) {
        config.spamExcludedChannels =
          [];

        saveAll();

        await interaction.reply({
          content:
            "All anti-spam excluded channels have been cleared.",
          ephemeral: true,
        });

        return;
      }

      if (!channel) {
        await interaction.reply({
          content:
            "Please select a text channel.",
          ephemeral: true,
        });

        return;
      }

      if (
        action === "add"
      ) {
        if (
          !config.spamExcludedChannels.includes(
            channel.id
          )
        ) {
          config.spamExcludedChannels.push(
            channel.id
          );
        }

        saveAll();

        await interaction.reply({
          content:
            `Anti-spam is now ignored in ${channel}.`,
          ephemeral: true,
        });

        return;
      }

      if (
        action === "remove"
      ) {
        config.spamExcludedChannels =
          config.spamExcludedChannels.filter(
            (id) =>
              id !==
              channel.id
          );

        saveAll();

        await interaction.reply({
          content:
            `Anti-spam is no longer ignored in ${channel}.`,
          ephemeral: true,
        });

        return;
      }

      return;
    }

    /* =====================================================
       /LEVEL-CHANNEL
    ===================================================== */

    if (
      interaction.commandName ===
      "level-channel"
    ) {
      const action =
        interaction.options.getString(
          "action",
          true
        );

      const channel =
        interaction.options.getChannel(
          "channel"
        );

      const config =
        getGuildSettings(
          guildId
        );

      if (
        action === "off"
      ) {
        config.levelUpChannelId =
          null;

        saveAll();

        await interaction.reply({
          content:
            "Level-up messages are now **OFF**.",
          ephemeral: true,
        });

        return;
      }

      if (
        action === "set"
      ) {
        if (
          !channel ||
          !channel.isTextBased()
        ) {
          await interaction.reply({
            content:
              "Please select a text channel.",
            ephemeral: true,
          });

          return;
        }

        config.levelUpChannelId =
          channel.id;

        saveAll();

        await interaction.reply({
          content:
            `Level-up messages will now be sent in ${channel}.`,
          ephemeral: true,
        });

        return;
      }

      return;
    }

    /* =====================================================
       /AFK-VOICE
    ===================================================== */

    if (
      interaction.commandName ===
      "afk-voice"
    ) {
      const action =
        interaction.options.getString(
          "action",
          true
        );

      const channel =
        interaction.options.getChannel(
          "channel"
        );

      const config =
        getGuildSettings(
          guildId
        );

      /* =========================
         OFF
      ========================= */

      if (
        action === "off"
      ) {
        config.afkVoiceChannelId =
          null;

        const connection =
          getVoiceConnection(
            guildId
          );

        if (connection) {
          try {
            connection.destroy();
          } catch {}
        }

        saveAll();

        await interaction.reply({
          content:
            "24/7 AFK Voice is now **OFF** and the bot has left the voice channel.",
          ephemeral: true,
        });

        return;
      }

      /* =========================
         SET / JOIN
      ========================= */

      if (
        action === "set"
      ) {
        if (
          !channel ||
          !channel.isVoiceBased()
        ) {
          await interaction.reply({
            content:
              "Please select a voice channel.",
            ephemeral: true,
          });

          return;
        }

        config.afkVoiceChannelId =
          channel.id;

        saveAll();

        const joined =
          await joinAfkVoice(
            interaction.guild,
            channel.id
          );

        if (!joined) {
          await interaction.reply({
            content:
              "I couldn't join that voice channel. Check my Connect permission.",
            ephemeral: true,
          });

          return;
        }

        await interaction.reply({
          content:
            `24/7 AFK Voice is now enabled in ${channel}.`,
          ephemeral: true,
        });

        return;
      }

      return;
    }
  }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);