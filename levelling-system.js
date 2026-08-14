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
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

/* =========================
   DATA
========================= */

const DATA_DIR = path.join(__dirname, "..", "data");

const LEVELS_FILE = path.join(
  DATA_DIR,
  "levels.json"
);

const ANNOUNCEMENTS_FILE = path.join(
  DATA_DIR,
  "announcements.json"
);

const ANTISPAM_FILE = path.join(
  DATA_DIR,
  "antispam.json"
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
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2)
  );
}

const levels = load(
  LEVELS_FILE,
  {}
);

const announcements = load(
  ANNOUNCEMENTS_FILE,
  {}
);

const antispam = load(
  ANTISPAM_FILE,
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
    ANTISPAM_FILE,
    antispam
  );
}

/* =========================
   RUNTIME DATA
========================= */

const recentMessages = new Map();

const commandCooldowns = new Map();

const spamTimeouts = new Map();

/* =========================
   CONSTANTS
========================= */

const SPAM_MESSAGE_LIMIT = 5;
const SPAM_WINDOW_MS = 3000;

const FIRST_TIMEOUT_MS =
  5 * 60 * 1000;

const SECOND_TIMEOUT_MS =
  20 * 60 * 1000;

const COMMAND_COOLDOWN_MS =
  2000;

/* =========================
   LEVEL SYSTEM
========================= */

function randomProgressTarget() {
  return (
    Math.floor(
      Math.random() * 4
    ) + 6
  );
}

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
      nextProgressNotice:
        randomProgressTarget(),
    };
  }

  if (
    typeof levels[guildId][userId]
      .nextProgressNotice !== "number"
  ) {
    levels[guildId][userId]
      .nextProgressNotice =
      levels[guildId][userId]
        .messages +
      randomProgressTarget();
  }

  return levels[guildId][userId];
}

function xpForLevel(level) {
  return Math.floor(
    100 *
      Math.pow(level, 1.5)
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

/* =========================
   MODERATOR CHECK
========================= */

function isModerator(member) {
  if (!member) {
    return false;
  }

  if (
    member.permissions.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  if (
    member.permissions.has(
      PermissionFlagsBits.ModerateMembers
    )
  ) {
    return true;
  }

  if (
    member.permissions.has(
      PermissionFlagsBits.ManageMessages
    )
  ) {
    return true;
  }

  if (
    member.permissions.has(
      PermissionFlagsBits.ManageGuild
    )
  ) {
    return true;
  }

  return false;
}

/* =========================
   ANTISPAM CONFIG
========================= */

function getGuildAntispam(
  guildId
) {
  if (!antispam[guildId]) {
    antispam[guildId] = {
      excludedChannelId: null,
    };
  }

  return antispam[guildId];
}

function isExcludedChannel(
  guildId,
  channelId
) {
  const config =
    getGuildAntispam(
      guildId
    );

  return (
    config.excludedChannelId ===
    channelId
  );
}

/* =========================
   SPAM TRACKING
========================= */

function getRecentMessages(
  guildId,
  userId
) {
  const key =
    `${guildId}:${userId}`;

  if (
    !recentMessages.has(key)
  ) {
    recentMessages.set(
      key,
      []
    );
  }

  return recentMessages.get(
    key
  );
}

function cleanRecentMessages(
  guildId,
  userId,
  now
) {
  const messages =
    getRecentMessages(
      guildId,
      userId
    );

  const cutoff =
    now - SPAM_WINDOW_MS;

  while (
    messages.length &&
    messages[0].timestamp <
      cutoff
  ) {
    messages.shift();
  }

  return messages;
}

function clearRecentMessages(
  guildId,
  userId
) {
  const key =
    `${guildId}:${userId}`;

  recentMessages.delete(key);
}

/* =========================
   COMMAND COOLDOWN
========================= */

function checkCommandCooldown(
  interaction
) {
  const key =
    `${interaction.guild.id}:${interaction.user.id}`;

  const now = Date.now();

  const lastUsed =
    commandCooldowns.get(key) ||
    0;

  const elapsed =
    now - lastUsed;

  if (
    elapsed <
    COMMAND_COOLDOWN_MS
  ) {
    return Math.ceil(
      (COMMAND_COOLDOWN_MS -
        elapsed) /
        1000
    );
  }

  commandCooldowns.set(
    key,
    now
  );

  return 0;
}

/* =========================
   SLASH COMMANDS
========================= */

const commands = [
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
            "Channel where the announcement will be sent"
          )
          .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName(
      "antispam-channel"
    )
    .setDescription(
      "Set or disable the channel where anti-spam timeouts are ignored"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addChannelOption(
      (option) =>
        option
          .setName("channel")
          .setDescription(
            "Channel to exclude from anti-spam timeouts"
          )
          .setRequired(false)
    ),
].map(
  (command) =>
    command.toJSON()
);

/* =========================
   CLIENT
========================= */

const client =
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

/* =========================
   REGISTER COMMANDS
========================= */

async function registerCommands() {
  const rest =
    new REST({
      version: "10",
    }).setToken(
      TOKEN
    );

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

/* =========================
   READY
========================= */

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

/* =========================
   SEND LEVEL MESSAGE
========================= */

async function sendProgressMessage(
  message,
  user
) {
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
            `${currentXP.toFixed(
              2
            )} / ${neededXP.toFixed(
              2
            )} XP`,
        }
      );

  await message.channel
    .send({
      embeds: [embed],
    })
    .catch(() => {});
}

/* =========================
   MESSAGE XP + ANTISPAM
========================= */

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

    const member =
      message.member;

    const now =
      Date.now();

    const recent =
      cleanRecentMessages(
        guildId,
        userId,
        now
      );

    recent.push({
      timestamp: now,
      xp: 0,
      messageCounted: false,
    });

    /* =========================
       ANTISPAM
    ========================= */

    const spamDetected =
      recent.length >
      SPAM_MESSAGE_LIMIT;

    const excluded =
      isExcludedChannel(
        guildId,
        message.channel.id
      );

    const moderator =
      isModerator(member);

    if (
      spamDetected &&
      !excluded &&
      !moderator
    ) {
      const key =
        `${guildId}:${userId}`;

      if (
        spamTimeouts.has(key)
      ) {
        clearRecentMessages(
          guildId,
          userId
        );

        return;
      }

      const user =
        getUser(
          guildId,
          userId
        );

      let removedXP = 0;
      let removedMessages = 0;

      for (
        const entry of recent
      ) {
        if (
          entry.messageCounted
        ) {
          removedXP +=
            entry.xp;

          removedMessages++;
        }
      }

      user.xp =
        Math.max(
          0,
          user.xp -
            removedXP
        );

      user.messages =
        Math.max(
          0,
          user.messages -
            removedMessages
        );

      user.level =
        calculateLevel(
          user.xp
        );

      saveAll();

      clearRecentMessages(
        guildId,
        userId
      );

      const previous =
        spamTimeouts.get(
          key
        );

      const isSecondOffense =
        previous === true;

      const timeoutDuration =
        isSecondOffense
          ? SECOND_TIMEOUT_MS
          : FIRST_TIMEOUT_MS;

      const timeoutMessage =
        isSecondOffense
          ? "again? hope you enjoy the 20 min!"
          : "oops! seems like you send a lot of messages in a short time👀";

      spamTimeouts.set(
        key,
        true
      );

      setTimeout(
        () => {
          spamTimeouts.delete(
            key
          );
        },
        timeoutDuration + 5000
      );

      try {
        if (
          member &&
          member.moderatable
        ) {
          await member.timeout(
            timeoutDuration,
            isSecondOffense
              ? "Repeated spam"
              : "Spam"
          );
        }

        await message.channel
          .send({
            content:
              timeoutMessage,
          })
          .catch(() => {});
      } catch (error) {
        console.error(
          "Failed to apply spam timeout:",
          error
        );
      }

      return;
    }

    /* =========================
       MODERATOR / EXCLUDED
       MESSAGE HANDLING
    ========================= */

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

    /* =========================
       XP CALCULATION
    ========================= */

    let xpPerWord =
      Math.floor(
        Math.random() * 10
      ) + 1;

    /*
      13% chance:
      11 to 100 XP per word.
    */

    if (
      Math.random() <
      0.13
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

    user.messages +=
      1;

    user.level =
      calculateLevel(
        user.xp
      );

    /* =========================
       TRACK XP FOR ANTISPAM
    ========================= */

    const latest =
      cleanRecentMessages(
        guildId,
        userId,
        now
      );

    const currentEntry =
      latest[
        latest.length - 1
      ];

    if (currentEntry) {
      currentEntry.xp =
        earnedXP;

      currentEntry.messageCounted =
        true;
    }

    saveAll();

    /* =========================
       LEVEL / PROGRESS NOTICE
    ========================= */

    const levelUp =
      user.level >
      oldLevel;

    const progressNotice =
      user.messages >=
      user.nextProgressNotice;

    if (
      levelUp ||
      progressNotice
    ) {
      await sendProgressMessage(
        message,
        user
      );

      user.nextProgressNotice =
        user.messages +
        randomProgressTarget();

      saveAll();
    }
  }
);

/* =========================
   TOP XP
========================= */

function getTopXP(
  guildId
) {
  return Object.entries(
    levels[guildId] || {}
  )
    .sort(
      (a, b) =>
        b[1].xp -
        a[1].xp
    )
    .slice(
      0,
      100
    );
}

/* =========================
   ANNOUNCEMENT BUILDER
========================= */

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
    ] =
      pageUsers[i];

    const guild =
      client.guilds.cache.get(
        guildId
      );

    const member =
      await guild?.members
        .fetch(userId)
        .catch(() => null);

    const name =
      member?.displayName ||
      member?.user
        ?.username ||
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
          `Page ${
            safePage + 1
          }/${totalPages}`,
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

/* =========================
   SEND ANNOUNCEMENT
========================= */

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
      config.type !==
      type
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
      .catch(() => {});
  }
}

/* =========================
   DAILY / WEEKLY TIMER
========================= */

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
      now.getUTCHours() ===
        0 &&
      now.getUTCMinutes() ===
        0 &&
      lastDaily !==
        dateKey
    ) {
      lastDaily =
        dateKey;

      await sendAnnouncement(
        "daily"
      );
    }

    if (
      now.getUTCDay() ===
        1 &&
      now.getUTCHours() ===
        0 &&
      now.getUTCMinutes() ===
        0 &&
      lastWeekly !==
        weekKey
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

/* =========================
   INTERACTIONS
========================= */

client.on(
  Events.InteractionCreate,
  async (
    interaction
  ) => {

    if (
      !interaction.guild
    ) {
      return;
    }

    /* =========================
       BUTTONS
    ========================= */

    if (
      interaction.isButton()
    ) {
      const parts =
        interaction.customId.split(
          "_"
        );

      if (
        parts[0] !==
        "xp"
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
        .update(
          updated
        )
        .catch(() => {});

      return;
    }

    /* =========================
       SLASH COMMAND CHECK
    ========================= */

    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    /* =========================
       COMMAND COOLDOWN
    ========================= */

    const cooldown =
      checkCommandCooldown(
        interaction
      );

    if (
      cooldown > 0
    ) {
      await interaction
        .reply({
          content:
            `Please wait ${cooldown} second(s) before using another command.`,
          ephemeral: true,
        })
        .catch(() => {});

      return;
    }

    const guildId =
      interaction.guild.id;

    /* =========================
       /LEVEL
    ========================= */

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
        await interaction.guild
          .members
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
              `${currentXP.toFixed(
                2
              )} / ${neededXP.toFixed(
                2
              )} XP`
          )
          .addFields(
            {
              name: "XP",
              value:
                `**${user.xp.toFixed(
                  2
                )}**`,
              inline: true,
            },
            {
              name:
                "Level",
              value:
                `**${user.level}**`,
              inline: true,
            },
            {
              name:
                "Messages",
              value:
                `**${user.messages.toLocaleString()}**`,
              inline: true,
            },
            {
              name:
                "Server",
              value:
                interaction
                  .guild
                  .name,
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

    /* =========================
       /TOP-XP
    ========================= */

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
        .reply(
          announcement
        )
        .catch(
          () => {}
        );

      return;
    }

    /* =========================
       /XP-ANNC
    ========================= */

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
        type ===
        "off"
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

    /* =========================
       /ANTISPAM-CHANNEL
    ========================= */

    if (
      interaction.commandName ===
      "antispam-channel"
    ) {
      const channel =
        interaction.options.getChannel(
          "channel"
        );

      const config =
        getGuildAntispam(
          guildId
        );

      if (!channel) {
        config.excludedChannelId =
          null;

        saveAll();

        await interaction
          .reply({
            content:
              "Anti-spam channel exclusion has been disabled.",
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

      config.excludedChannelId =
        channel.id;

      saveAll();

      await interaction
        .reply({
          content:
            `Anti-spam timeouts are now disabled in ${channel}.`,
          ephemeral: true,
        })
        .catch(
          () => {}
        );

      return;
    }
  }
);

/* =========================
   LOGIN
========================= */

client.login(
  TOKEN
);