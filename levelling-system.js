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

const AFK_VOICE_CHANNEL_ID =
  process.env.AFK_VOICE_CHANNEL_ID || "";

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

/* =========================================================
   SETTINGS
========================================================= */

const SPAM_MESSAGE_LIMIT = 5;
const SPAM_WINDOW_MS = 3000;

const FIRST_SPAM_TIMEOUT_MS = 5 * 60 * 1000;
const SECOND_SPAM_TIMEOUT_MS = 20 * 60 * 1000;

const SPAM_ACTION_DELAY_MS = 2000;
const COMMAND_COOLDOWN_MS = 2000;

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

function saveAll() {
  save(LEVELS_FILE, levels);
  save(ANNOUNCEMENTS_FILE, announcements);
  save(SETTINGS_FILE, settings);
}

/* =========================================================
   GUILD SETTINGS
========================================================= */

function getGuildSettings(guildId) {
  if (!settings[guildId]) {
    settings[guildId] = {
      spamEnabled: true,
      spamExemptChannelId: null,
      xpExemptChannelId: null,
      levelChannelId: null,
      afkVoiceChannelId: null,
    };
  }

  /*
    Keep compatibility with existing settings files
    that were created before /vafk was added.
  */

  if (
    !Object.prototype.hasOwnProperty.call(
      settings[guildId],
      "afkVoiceChannelId"
    )
  ) {
    settings[guildId].afkVoiceChannelId = null;
  }

  return settings[guildId];
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
   SPAM MEMORY
========================================================= */

const spamTracker = new Map();
const spamActionLock = new Map();
const spamStrikes = new Map();

/* =========================================================
   COMMAND COOLDOWN
========================================================= */

const commandCooldowns = new Map();

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
   SPAM DETECTION
========================================================= */

function registerSpamMessage(
  guildId,
  userId
) {
  const key =
    getSpamKey(
      guildId,
      userId
    );

  const now = Date.now();

  let timestamps =
    spamTracker.get(key) || [];

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

  if (!guildSettings.spamEnabled) {
    return false;
  }

  if (
    guildSettings.spamExemptChannelId ===
    message.channel.id
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

  const count =
    registerSpamMessage(
      message.guild.id,
      message.author.id
    );

  if (
    count <= SPAM_MESSAGE_LIMIT
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
     /top-xp
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
     /spam
  ========================= */

  new SlashCommandBuilder()
    .setName("spam")
    .setDescription(
      "Enable or disable anti-spam protection"
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
     /spam-exempt
  ========================= */

  new SlashCommandBuilder()
    .setName("spam-exempt")
    .setDescription(
      "Set a channel where anti-spam timeouts are disabled"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
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

  /* =========================
     /xp-exempt
  ========================= */

  new SlashCommandBuilder()
    .setName("xp-exempt")
    .setDescription(
      "Set a channel where messages do not give XP"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
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
      "Make the bot join a voice channel and stay AFK there"
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
            ChannelType.GuildVoice
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
   AFK VOICE 24/7
========================================================= */

async function joinAFKVoice(
  requestedChannelId = null,
  saveSetting = false
) {
  let channelId =
    requestedChannelId;

  /*
    If /vafk did not provide a channel,
    use the saved guild setting first.

    The old AFK_VOICE_CHANNEL_ID environment
    variable remains as a fallback for compatibility.
  */

  if (!channelId) {
    for (
      const guild of client.guilds.cache.values()
    ) {
      const guildSettings =
        getGuildSettings(
          guild.id
        );

      const savedChannelId =
        guildSettings.afkVoiceChannelId ||
        AFK_VOICE_CHANNEL_ID;

      if (!savedChannelId) {
        continue;
      }

      await joinAFKVoiceForGuild(
        guild,
        savedChannelId,
        false
      );
    }

    return;
  }

  /*
    Find the guild containing the selected
    voice channel.
  */

  const channel =
    client.channels.cache.get(
      channelId
    );

  if (!channel) {
    console.error(
      "AFK voice channel was not found."
    );

    return false;
  }

  if (
    channel.type !==
    ChannelType.GuildVoice
  ) {
    console.error(
      "AFK voice channel is not a voice channel."
    );

    return false;
  }

  const result =
    await joinAFKVoiceForGuild(
      channel.guild,
      channel.id,
      saveSetting
    );

  return result;
}

/* =========================================================
   JOIN AFK VOICE FOR GUILD
========================================================= */

async function joinAFKVoiceForGuild(
  guild,
  channelId,
  saveSetting = false
) {
  const channel =
    guild.channels.cache.get(
      channelId
    );

  if (!channel) {
    console.error(
      `AFK voice channel ${channelId} was not found in ${guild.name}.`
    );

    /*
      If the saved channel was deleted,
      remove the invalid saved setting.
    */

    const guildSettings =
      getGuildSettings(
        guild.id
      );

    if (
      guildSettings.afkVoiceChannelId ===
      channelId
    ) {
      guildSettings.afkVoiceChannelId =
        null;

      saveAll();
    }

    return false;
  }

  if (
    channel.type !==
    ChannelType.GuildVoice
  ) {
    console.error(
      "AFK_VOICE_CHANNEL_ID is not a voice channel."
    );

    return false;
  }

  const botMember =
    guild.members.me;

  if (!botMember) {
    console.error(
      `Bot member was not found in ${guild.name}.`
    );

    return false;
  }

  /*
    The bot needs Connect permission to enter
    and Speak is not required because the bot
    is self-muted.
  */

  const permissions =
    channel.permissionsFor(
      botMember
    );

  if (
    !permissions ||
    !permissions.has(
      PermissionFlagsBits.Connect
    )
  ) {
    console.error(
      `Bot does not have Connect permission in ${channel.name}.`
    );

    return false;
  }

  try {
    const existing =
      getVoiceConnection(
        guild.id
      );

    /*
      If already connected to this exact channel,
      keep the current connection alive.
    */

    if (existing) {
      const currentChannelId =
        existing.joinConfig
          ?.channelId;

      if (
        currentChannelId ===
        channel.id
      ) {
        if (saveSetting) {
          const guildSettings =
            getGuildSettings(
              guild.id
            );

          guildSettings.afkVoiceChannelId =
            channel.id;

          saveAll();
        }

        return true;
      }

      /*
        /vafk selected another voice channel.
        Move the bot by destroying the old
        connection first.
      */

      try {
        existing.destroy();
      } catch (error) {
        console.error(
          "Failed to destroy previous AFK voice connection:",
          error
        );
      }
    }

    const connection =
      joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator:
          guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
      });

    connection.on(
      "error",
      (error) => {
        console.error(
          "AFK voice connection error:",
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
          `AFK voice state in ${guild.name}: ${oldState.status} -> ${newState.status}`
        );
      }
    );

    /*
      Save the selected voice channel so the
      bot knows where to return after restart.
    */

    if (saveSetting) {
      const guildSettings =
        getGuildSettings(
          guild.id
        );

      guildSettings.afkVoiceChannelId =
        channel.id;

      saveAll();
    }

    console.log(
      `Joined AFK voice channel: ${channel.name} in ${guild.name}`
    );

    return true;
  } catch (error) {
    console.error(
      "Failed to join AFK voice:",
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

    /*
      Restore saved /vafk voice channels after
      the bot starts again.

      The old AFK_VOICE_CHANNEL_ID environment
      variable is still supported as fallback.
    */

    await joinAFKVoice();
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
      IMPORTANT:

      We save the old level BEFORE giving XP.

      This is what makes the level-up message
      appear ONLY when the user's level actually
      increases.
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

    /*
      Update the stored level.

      The level-up message below is triggered
      ONLY if newLevel > oldLevel.
    */

    user.level =
      newLevel;

    /* =====================================================
       SAVE BEFORE LEVEL-UP MESSAGE
    ===================================================== */

    saveAll();

    /* =====================================================
       LEVEL UP
    ===================================================== */

    /*
      THIS IS THE IMPORTANT PART.

      The message can ONLY happen when:

      oldLevel = 0
      newLevel = 1

      or:

      oldLevel = 1
      newLevel = 2

      or:

      oldLevel = 2
      newLevel = 3

      etc.

      If the user sends 100 messages while staying
      at the same level, NOTHING is sent.
    */

    if (
      newLevel <= oldLevel
    ) {
      return;
    }

    /*
      A level was actually gained.
      Send ONE message only.
    */

    const levelChannelId =
      guildSettings.levelChannelId;

    /*
      If no level channel has been configured,
      do not send the level message anywhere.
    */

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

    /*
      ONE SEND ONLY.

      No timer.
      No interval.
      No message counter.
      No repeated level announcement.

      It only runs after newLevel > oldLevel.
    */

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
       /SPAM
    ===================================================== */

    if (
      interaction.commandName ===
      "spam"
    ) {
      const mode =
        interaction.options.getString(
          "mode",
          true
        );

      guildSettings.spamEnabled =
        mode === "on";

      /*
        Clear existing spam tracking when
        anti-spam is switched off.
      */

      if (
        guildSettings.spamEnabled ===
        false
      ) {
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
            guildSettings.spamEnabled
              ? "Anti-spam is now enabled."
              : "Anti-spam is now disabled.",
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }

    /* =====================================================
       /SPAM-EXEMPT
    ===================================================== */

    if (
      interaction.commandName ===
      "spam-exempt"
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

      /*
        Extra safety check even though the slash
        command only accepts voice channels.
      */

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

      /*
        Check that the bot can actually connect
        to the selected voice channel.
      */

      const botMember =
        interaction.guild.members.me;

      if (!botMember) {
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
        !permissions ||
        !permissions.has(
          PermissionFlagsBits.Connect
        )
      ) {
        await interaction
          .reply({
            content:
              `I don't have permission to connect to ${channel}.`,
            ephemeral: true,
          })
          .catch(
            () => {}
          );

        return;
      }

      /*
        Save the selected channel and join it.
      */

      const joined =
        await joinAFKVoiceForGuild(
          interaction.guild,
          channel.id,
          true
        );

      if (!joined) {
        await interaction
          .reply({
            content:
              "I couldn't join that voice channel. Check my voice permissions and try again.",
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
            `I'm now AFK in ${channel} until the bot is turned off, removed, or the channel is deleted.`,
          ephemeral: true,
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