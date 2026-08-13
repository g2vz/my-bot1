const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
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

/*
  Level XP curve.

  Level 0 -> 0 XP
  Level 1 -> 100 XP
  Level 2 -> 282 XP
  Level 3 -> 519 XP
  etc.
*/

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
  if (needed <= 0) return "████████████";

  const filled = Math.floor((current / needed) * size);

  return (
    "█".repeat(Math.max(0, Math.min(size, filled))) +
    "░".repeat(Math.max(0, size - filled))
  );
}

function getRank(guildId, userId) {
  const users = Object.entries(levels[guildId] || {});

  users.sort((a, b) => b[1].xp - a[1].xp);

  const index = users.findIndex(([id]) => id === userId);

  return index === -1 ? users.length + 1 : index + 1;
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
    .setName("top-XP")
    .setDescription("shows the top 10 members in XP"),

  new SlashCommandBuilder()
    .setName("xp-annc")
    .setDescription("Configure daily or weekly XP announcements")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Announcement type")
        .setRequired(true)
        .addChoices(
          { name: "Daily", value: "daily" },
          { name: "Weekly", value: "weekly" },
          { name: "Off", value: "off" }
        )
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel where the annc will be sent")
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
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log("Guild slash commands registered.");
  } else {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log("Global slash commands registered.");
  }
}

/* =========================
   READY
========================= */

client.once(Events.ClientReady, async (bot) => {
  console.log(`Logged in as ${bot.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
});

/* =========================
   MESSAGE XP
========================= */

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (!message.content) return;

  const user = getUser(
    message.guild.id,
    message.author.id
  );

  const oldLevel = user.level;

  /*
    0.50 XP per character.

    Spaces are ignored so people can't farm XP
    by sending huge amounts of spaces.
  */

  const characters = message.content.replace(/\s/g, "").length;

  const earnedXP = characters * 0.5;

  user.xp += earnedXP;
  user.messages += 1;

  user.level = calculateLevel(user.xp);

  saveAll();

  /* =========================
     LEVEL UP
  ========================= */

  if (user.level > oldLevel) {
    const currentLevelXP = xpForLevel(user.level);
    const nextLevelXP = xpForLevel(user.level + 1);

    const currentXP = user.xp - currentLevelXP;
    const neededXP = nextLevelXP - currentLevelXP;

    const embed = new EmbedBuilder()
      .setColor(0x81c1eb)
      .setTitle("you have levelled up! keep it up for a cookei🍪!")
      .setDescription(
        `${message.author} reached **Level ${user.level}**!`
      )
      .addFields(
        {
          name: "XP",
          value: `**${user.xp.toFixed(2)} XP**`,
          inline: true,
        },
        {
          name: "Progress",
          value:
            `${progressBar(currentXP, neededXP)}\n` +
            `${currentXP.toFixed(2)} / ${neededXP.toFixed(2)} XP`,
        }
      );

    await message.channel.send({
      embeds: [embed],
    }).catch(() => {});
  }
});

/* =========================
   TOP XP
========================= */

function getTopXP(guildId) {
  return Object.entries(levels[guildId] || {})
    .sort((a, b) => b[1].xp - a[1].xp)
    .slice(0, 10);
}

/* =========================
   ANNOUNCEMENTS
========================= */

function buildAnnouncement(guildId, type) {
  const top = getTopXP(guildId);

  if (!top.length) {
    return "No XP data yet.";
  }

  const title =
    type === "daily"
      ? "📅 Daily XP Leaderboard"
      : "🗓️ Weekly XP Leaderboard";

  const medals = ["🥇", "🥈", "🥉"];

  const rows = top.map(([userId, user], index) => {
    const position =
      medals[index] || `**#${index + 1}**`;

    return (
      `${position} <@${userId}>` +
      ` • Level **${user.level}**` +
      ` • **${user.xp.toFixed(2)} XP**`
    );
  });

  return `**${title}**\n\n${rows.join("\n")}`;
}

async function sendAnnouncement(type) {
  for (const [guildId, config] of Object.entries(announcements)) {
    if (config.type !== type) continue;
    if (!config.channelId) continue;

    const guild = client.guilds.cache.get(guildId);

    if (!guild) continue;

    const channel = guild.channels.cache.get(
      config.channelId
    );

    if (!channel || !channel.isTextBased()) continue;

    await channel.send(
      buildAnnouncement(guildId, type)
    ).catch(() => {});
  }
}

/*
  Daily:
  Every day at 00:00 UTC

  Weekly:
  Every Monday at 00:00 UTC
*/

let lastDaily = "";
let lastWeekly = "";

setInterval(async () => {
  const now = new Date();

  const dateKey = now.toISOString().slice(0, 10);

  const weekKey =
    `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

  if (
    now.getUTCHours() === 0 &&
    now.getUTCMinutes() === 0 &&
    lastDaily !== dateKey
  ) {
    lastDaily = dateKey;

    await sendAnnouncement("daily");
  }

  if (
    now.getUTCDay() === 1 &&
    now.getUTCHours() === 0 &&
    now.getUTCMinutes() === 0 &&
    lastWeekly !== weekKey
  ) {
    lastWeekly = weekKey;

    await sendAnnouncement("weekly");
  }
}, 60_000);

/* =========================
   INTERACTIONS
========================= */

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  const guildId = interaction.guild.id;

  /* =========================
     /LEVEL
  ========================= */

  if (interaction.commandName === "level") {
    const target =
      interaction.options.getUser("member") ||
      interaction.user;

    const member =
      await interaction.guild.members
        .fetch(target.id)
        .catch(() => null);

    const displayName =
      member?.displayName ||
      target.username;

    const user = getUser(
      guildId,
      target.id
    );

    const rank = getRank(
      guildId,
      target.id
    );

    const currentLevelXP =
      xpForLevel(user.level);

    const nextLevelXP =
      xpForLevel(user.level + 1);

    const currentXP =
      user.xp - currentLevelXP;

    const neededXP =
      nextLevelXP - currentLevelXP;

    const embed = new EmbedBuilder()
      .setColor(0x00d4ff)
      .setAuthor({
        name: `${displayName}'s information`,
        iconURL: target.displayAvatarURL(),
      })
      .setDescription(
        `**Level ${user.level}**\n` +
        `Rank **#${rank}**\n\n` +
        `${progressBar(currentXP, neededXP)}\n` +
        `${currentXP.toFixed(2)} / ${neededXP.toFixed(2)} XP`
      )
      .addFields(
        {
          name: "XP",
          value: `**${user.xp.toFixed(2)}**`,
          inline: true,
        },
        {
          name: "Level",
          value: `**${user.level}**`,
          inline: true,
        },
        {
          name: "Messages",
          value: `**${user.messages.toLocaleString()}**`,
          inline: true,
        },
        {
          name: "Server",
          value: interaction.guild.name,
        }
      )
      .setThumbnail(target.displayAvatarURL())
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

  if (interaction.commandName === "top-xp") {
    const top = getTopXP(guildId);

    const medals = ["🥇", "🥈", "🥉"];

    const rows = top.map(([userId, user], index) => {
      const position =
        medals[index] || `**#${index + 1}**`;

      return (
        `${position} <@${userId}>` +
        ` • Level **${user.level}**` +
        ` • **${user.xp.toFixed(2)} XP**`
      );
    });

    const embed = new EmbedBuilder()
      .setColor(0x00d4ff)
      .setTitle("🏆 Top XP")
      .setDescription(
        rows.length
          ? rows.join("\n")
          : "No XP data yet."
      );

    await interaction.reply({
      embeds: [embed],
    });

    return;
  }

  /* =========================
     /ANNOUNCEMENT
  ========================= */

  if (interaction.commandName === "announcement") {
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
      delete announcements[guildId];

      saveAll();

      await interaction.reply({
        content:
          "XP announcements are now disabled.",
        ephemeral: true,
      });

      return;
    }

    if (!channel || !channel.isTextBased()) {
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
  }
});

/* =========================
   LOGIN
========================= */

client.login(TOKEN);