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
const LEVELS_FILE = path.join(DATA_DIR, "levels.json");
const ANNOUNCEMENTS_FILE = path.join(DATA_DIR, "announcements.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function load(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const levels = load(LEVELS_FILE, {});
const announcements = load(ANNOUNCEMENTS_FILE, {});

function saveAll() {
  save(LEVELS_FILE, levels);
  save(ANNOUNCEMENTS_FILE, announcements);
}

/* =========================
   LEVEL SYSTEM
========================= */

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
  return Math.floor(100 * Math.pow(level, 1.5));
}

function calculateLevel(xp) {
  let level = 0;

  while (xp >= xpForLevel(level + 1)) {
    level++;
  }

  return level;
}

function progressBar(current, needed, size = 12) {
  if (needed <= 0) {
    return "████████████";
  }

  const percentage = Math.max(
    0,
    Math.min(1, current / needed)
  );

  const filled = Math.floor(percentage * size);

  return (
    "█".repeat(filled) +
    "░".repeat(size - filled)
  );
}

function getRank(guildId, userId) {
  const users = Object.entries(
    levels[guildId] || {}
  );

  users.sort((a, b) => b[1].xp - a[1].xp);

  const index = users.findIndex(
    ([id]) => id === userId
  );

  return index === -1
    ? users.length + 1
    : index + 1;
}

/* =========================
   SLASH COMMANDS
========================= */

const commands = [
  new SlashCommandBuilder()
    .setName("level")
    .setDescription("Show your level and XP")
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Member to check")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("top-xp")
    .setDescription("Show the top 100 members by XP"),

  new SlashCommandBuilder()
    .setName("xp-annc")
    .setDescription(
      "Configure daily or weekly XP announcements"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Announcement type")
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
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(
          "Channel where the announcement will be sent"
        )
        .setRequired(false)
    ),
].map((command) => command.toJSON());

/* =========================
   CLIENT
========================= */

const client = new Client({
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
  const rest = new REST({
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
      Routes.applicationCommands(CLIENT_ID),
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
   MESSAGE XP
========================= */

client.on(
  Events.MessageCreate,
  async (message) => {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (!message.content) return;

    const user = getUser(
      message.guild.id,
      message.author.id
    );

    const oldLevel = user.level;

    const words = message.content
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!words.length) return;

    /*
      Normal XP:
      Each word gives a random amount from 1 to 10 XP.
    */

    let xpPerWord =
      Math.floor(Math.random() * 10) + 1;

    /*
      13% chance:
      Each word gives a random amount from 11 to 99 XP.
    */

    if (Math.random() < 0.13) {
      xpPerWord =
        Math.floor(Math.random() * 89) + 11;
    }

    const earnedXP =
      words.length * xpPerWord;

    user.xp += earnedXP;
    user.messages += 1;

    /*
      5% chance:
      Move directly to the next level.
    */

    const levelSkip =
      Math.random() < 0.05;

    if (levelSkip) {
      const nextLevel =
        Math.max(
          oldLevel + 1,
          calculateLevel(user.xp)
        );

      user.level = nextLevel;

      const requiredXP =
        xpForLevel(nextLevel);

      if (user.xp < requiredXP) {
        user.xp = requiredXP;
      }
    } else {
      user.level =
        calculateLevel(user.xp);
    }

    saveAll();

    /* =========================
       LEVEL UP
    ========================= */

    if (user.level > oldLevel) {
      const currentLevelXP =
        xpForLevel(user.level);

      const nextLevelXP =
        xpForLevel(user.level + 1);

      const currentXP =
        user.xp - currentLevelXP;

      const neededXP =
        nextLevelXP - currentLevelXP;

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

      await message.channel
        .send({
          embeds: [embed],
        })
        .catch(() => {});
    }
  }
);

/* =========================
   TOP XP
========================= */

function getTopXP(guildId) {
  return Object.entries(
    levels[guildId] || {}
  )
    .sort(
      (a, b) => b[1].xp - a[1].xp
    )
    .slice(0, 100);
}

/* =========================
   ANNOUNCEMENT BUILDER
========================= */

async function buildAnnouncement(
  guildId,
  type,
  page = 0
) {
  const top = getTopXP(guildId);

  const totalPages = Math.max(
    1,
    Math.ceil(top.length / 10)
  );

  const safePage = Math.max(
    0,
    Math.min(page, totalPages - 1)
  );

  const start = safePage * 10;

  const pageUsers = top.slice(
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
      client.guilds.cache.get(guildId);

    const member =
      await guild?.members
        .fetch(userId)
        .catch(() => null);

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
          .setLabel("Previous")
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
          .setLabel("Next")
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

async function sendAnnouncement(type) {
  for (
    const [
      guildId,
      config,
    ] of Object.entries(announcements)
  ) {
    if (config.type !== type) continue;
    if (!config.channelId) continue;

    const guild =
      client.guilds.cache.get(guildId);

    if (!guild) continue;

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
    const now = new Date();

    const dateKey =
      now.toISOString().slice(0, 10);

    const weekKey =
      `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

    if (
      now.getUTCHours() === 0 &&
      now.getUTCMinutes() === 0 &&
      lastDaily !== dateKey
    ) {
      lastDaily = dateKey;

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
      lastWeekly = weekKey;

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
  async (interaction) => {

    /* =========================
       BUTTONS
    ========================= */

    if (interaction.isButton()) {
      const parts =
        interaction.customId.split("_");

      if (parts[0] !== "xp") {
        return;
      }

      const direction = parts[1];
      const guildIdFromButton = parts[2];
      const type = parts[3];

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
          ? Number(pageMatch[1]) - 1
          : 0;

      const totalPages =
        pageMatch
          ? Number(pageMatch[2])
          : 1;

      let newPage =
        currentPage;

      if (direction === "next") {
        newPage =
          Math.min(
            currentPage + 1,
            totalPages - 1
          );
      }

      if (direction === "prev") {
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

    if (!interaction.guild) {
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
        ) || interaction.user;

      const member =
        await interaction.guild.members
          .fetch(target.id)
          .catch(() => null);

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
        xpForLevel(user.level);

      const nextLevelXP =
        xpForLevel(
          user.level + 1
        );

      const currentXP =
        user.xp -
        currentLevelXP;

      const neededXP =
        nextLevelXP -
        currentLevelXP;

      const embed =
        new EmbedBuilder()
          .setColor(0x00d4ff)
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

    /* =========================
       /TOP-XP
    ========================= */

    if (
      interaction.commandName ===
      "top-xp"
    ) {
      const top =
        getTopXP(guildId);

      const totalPages =
        Math.max(
          1,
          Math.ceil(top.length / 10)
        );

      const page = 0;

      const announcement =
        await buildAnnouncement(
          guildId,
          "daily",
          page
        );

      await interaction.reply(
        announcement
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

      if (type === "off") {
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

      announcements[guildId] = {
        type,
        channelId: channel.id,
      };

      saveAll();

      await interaction.reply({
        content:
          `${type === "daily" ? "Daily" : "Weekly"} ` +
          `XP announcements are now enabled in ${channel}.`,
        ephemeral: true,
      });

      return;
    }
  }
);

/* =========================
   LOGIN
========================= */

client.login(TOKEN);