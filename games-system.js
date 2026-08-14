const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

/* =========================================================
   CONFIG
========================================================= */

const OWNER_ID = "1193602200644091957";

const DATA_DIR = path.join(__dirname, "data");
const PL_FILE = path.join(DATA_DIR, "pl.json");
const SHORTS_FILE = path.join(DATA_DIR, "shorts.json");
const REWARDS_FILE = path.join(DATA_DIR, "level-rewards.json");

fs.mkdirSync(DATA_DIR, {
  recursive: true,
});

/* =========================================================
   HELPERS
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
    console.error(`Failed to load ${file}:`, error);
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
    console.error(`Failed to save ${file}:`, error);
  }
}

const plData = load(PL_FILE, {});
const shorts = load(SHORTS_FILE, {});
const levelRewards = load(REWARDS_FILE, {});

/* =========================================================
   PL ECONOMY
========================================================= */

function getPL(guildId, userId) {
  if (!plData[guildId]) {
    plData[guildId] = {};
  }

  if (
    typeof plData[guildId][userId] !== "number"
  ) {
    plData[guildId][userId] = 0;
  }

  return plData[guildId][userId];
}

function setPL(guildId, userId, amount) {
  if (!plData[guildId]) {
    plData[guildId] = {};
  }

  plData[guildId][userId] = Math.max(
    0,
    Number(amount) || 0
  );

  save(PL_FILE, plData);
}

function addPL(guildId, userId, amount) {
  const current = getPL(guildId, userId);

  setPL(
    guildId,
    userId,
    current + Number(amount)
  );
}

function removePL(guildId, userId, amount) {
  const current = getPL(guildId, userId);

  setPL(
    guildId,
    userId,
    Math.max(
      0,
      current - Number(amount)
    )
  );
}

function formatPL(amount) {
  return `${Number(amount).toLocaleString()} PL`;
}

/* =========================================================
   OWNER CHECK
========================================================= */

function isOwner(userId) {
  return userId === OWNER_ID;
}

/* =========================================================
   MODERATOR CHECK
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

/* =========================================================
   COOLDOWNS
========================================================= */

const economyCooldowns = new Map();

function cooldown(
  map,
  guildId,
  userId,
  command,
  duration
) {
  const key =
    `${guildId}:${userId}:${command}`;

  const now = Date.now();

  const last =
    map.get(key) || 0;

  const remaining =
    duration - (now - last);

  if (remaining > 0) {
    return remaining;
  }

  map.set(key, now);

  return 0;
}

/* =========================================================
   DAILY
========================================================= */

const dailyClaims = new Map();

function getDailyKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function canClaimDaily(guildId, userId) {
  const key =
    getDailyKey(guildId, userId);

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  return dailyClaims.get(key) !== today;
}

function claimDaily(guildId, userId) {
  const key =
    getDailyKey(guildId, userId);

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  dailyClaims.set(key, today);
}

/* =========================================================
   SIDE JOB
========================================================= */

function randomBetween(min, max) {
  return Math.floor(
    Math.random() *
      (max - min + 1)
  ) + min;
}

/* =========================================================
   PAYMENT
========================================================= */

/*
  Reputation can be supplied by the main bot.

  The function below accepts the user's reputation
  and calculates a random payment.

  Maximum = 4000 PL.
*/

function calculatePayment(reputation) {
  const rep =
    Math.max(
      0,
      Number(reputation) || 0
    );

  const base =
    Math.min(
      4000,
      250 + rep * 100
    );

  const minimum =
    Math.min(
      base,
      Math.max(
        100,
        Math.floor(base * 0.65)
      )
    );

  return randomBetween(
    minimum,
    Math.min(4000, base)
  );
}

/* =========================================================
   LEVEL REWARDS
========================================================= */

function getGuildRewards(guildId) {
  if (!levelRewards[guildId]) {
    levelRewards[guildId] = {};
  }

  return levelRewards[guildId];
}

async function checkLevelRewards(
  guild,
  member,
  newLevel
) {
  const rewards =
    getGuildRewards(
      guild.id
    );

  const reward =
    rewards[String(newLevel)];

  if (!reward) {
    return;
  }

  const role =
    guild.roles.cache.get(
      reward.roleId
    );

  if (!role) {
    return;
  }

  if (
    member.roles.cache.has(
      role.id
    )
  ) {
    return;
  }

  await member.roles
    .add(
      role,
      `Level ${newLevel} reward`
    )
    .catch(
      (error) => {
        console.error(
          "Failed to give level reward:",
          error
        );
      }
    );
}

/* =========================================================
   SHORT COMMAND SYSTEM
========================================================= */

function getShort(
  guildId,
  command
) {
  if (!shorts[guildId]) {
    return command;
  }

  return (
    shorts[guildId][command] ||
    command
  );
}

function setShort(
  guildId,
  command,
  value
) {
  if (!shorts[guildId]) {
    shorts[guildId] = {};
  }

  shorts[guildId][command] =
    value;

  save(
    SHORTS_FILE,
    shorts
  );
}

/* =========================================================
   GAME STATE
========================================================= */

const games = new Map();

/*
  Every game has its own object.

  Example:

  games.set(messageId, {
    type: "chairs",
    guildId,
    players: [],
    started: false,
    ...
  });
*/

/* =========================================================
   CHAIRS
========================================================= */

function createChairsGame(
  guildId,
  hostId
) {
  const game = {
    type: "chairs",
    guildId,
    hostId,
    players: [],
    registered: new Set(),
    squares: [],
    guesses: new Map(),
    scores: {},
    started: false,
    round: 0,
  };

  games.set(
    `${guildId}:chairs`,
    game
  );

  return game;
}

function getChairsGame(guildId) {
  return games.get(
    `${guildId}:chairs`
  );
}

function generateSquares(
  playerCount
) {
  const total =
    playerCount + 10;

  const squares =
    Array.from(
      { length: total },
      (_, index) => ({
        number: index + 1,
        playerId: null,
      })
    );

  return squares;
}

function assignRandomSquares(game) {
  const squares =
    generateSquares(
      game.players.length
    );

  const shuffled =
    [...squares].sort(
      () => Math.random() - 0.5
    );

  for (
    let i = 0;
    i < game.players.length;
    i++
  ) {
    shuffled[i].playerId =
      game.players[i];
  }

  game.squares =
    shuffled;

  return shuffled;
}

/* =========================================================
   MAFIA
========================================================= */

function createMafiaGame(
  guildId,
  hostId
) {
  const game = {
    type: "mafia",
    guildId,
    hostId,
    players: [],
    roles: {},
    alive: new Set(),
    phase: "registration",
    round: 0,
  };

  games.set(
    `${guildId}:mafia`,
    game
  );

  return game;
}

/* =========================================================
   TIC TAC TOE
========================================================= */

function createTTTGame(
  guildId,
  hostId
) {
  const game = {
    type: "ttt",
    guildId,
    hostId,
    players: [],
    board: Array(9).fill(null),
    turn: 0,
    started: false,
  };

  games.set(
    `${guildId}:ttt`,
    game
  );

  return game;
}

/* =========================================================
   HIDE AND SEEK
========================================================= */

function createHideNSeekGame(
  guildId,
  hostId
) {
  const game = {
    type: "hideNseek",
    guildId,
    hostId,
    players: [],
    hider: null,
    seekers: [],
    started: false,
    round: 0,
  };

  games.set(
    `${guildId}:hideNseek`,
    game
  );

  return game;
}

/* =========================================================
   BROKEN WORD
========================================================= */

const brokenWords = [
  {
    word: "discord",
    scrambled: "sdcroid",
  },
  {
    word: "computer",
    scrambled: "puctomer",
  },
  {
    word: "community",
    scrambled: "mocmunity",
  },
  {
    word: "javascript",
    scrambled: "vjascript",
  },
  {
    word: "level",
    scrambled: "vlee",
  },
  {
    word: "reputation",
    scrambled: "putaretion",
  },
  {
    word: "champion",
    scrambled: "hampicon",
  },
  {
    word: "keyboard",
    scrambled: "yebkardo",
  },
];

const brokenWordGames =
  new Map();

function createBrokenWordGame(
  guildId
) {
  const item =
    brokenWords[
      randomBetween(
        0,
        brokenWords.length - 1
      )
    ];

  const game = {
    guildId,
    answer:
      item.word,
    scrambled:
      item.scrambled,
    startedAt:
      Date.now(),
    winner: null,
  };

  brokenWordGames.set(
    guildId,
    game
  );

  return game;
}

/* =========================================================
   ADMIN COMMANDS
========================================================= */

const adminCommands = [
  new SlashCommandBuilder()
    .setName("chairs")
    .setDescription(
      "Start a Chairs game"
    ),

  new SlashCommandBuilder()
    .setName("mafia")
    .setDescription(
      "Start a Mafia game"
    ),

  new SlashCommandBuilder()
    .setName("ttt")
    .setDescription(
      "Start a Tic Tac Toe game"
    ),

  new SlashCommandBuilder()
    .setName("hideNseek")
    .setDescription(
      "Start a Hide and Seek game"
    ),

  new SlashCommandBuilder()
    .setName("level-reward")
    .setDescription(
      "Set a role reward for reaching a level"
    )
    .addIntegerOption(
      option =>
        option
          .setName("level")
          .setDescription(
            "Required level"
          )
          .setRequired(true)
          .setMinValue(1)
    )
    .addRoleOption(
      option =>
        option
          .setName("role")
          .setDescription(
            "Role given at this level"
          )
          .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("short")
    .setDescription(
      "Change an administrative command shortcut"
    )
    .addStringOption(
      option =>
        option
          .setName("command")
          .setDescription(
            "Command to change"
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
              name: "Kick",
              value: "kick",
            },
            {
              name: "Ban",
              value: "ban",
            }
          )
    )
    .addStringOption(
      option =>
        option
          .setName("shortcut")
          .setDescription(
            "New command shortcut"
          )
          .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("add-pl")
    .setDescription(
      "Give PL to a member"
    )
    .addUserOption(
      option =>
        option
          .setName("member")
          .setDescription(
            "Member receiving PL"
          )
          .setRequired(true)
    )
    .addIntegerOption(
      option =>
        option
          .setName("amount")
          .setDescription(
            "Amount of PL"
          )
          .setRequired(true)
          .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("take-pl")
    .setDescription(
      "Take PL from a member"
    )
    .addUserOption(
      option =>
        option
          .setName("member")
          .setDescription(
            "Member losing PL"
          )
          .setRequired(true)
    )
    .addIntegerOption(
      option =>
        option
          .setName("amount")
          .setDescription(
            "Amount of PL"
          )
          .setRequired(true)
          .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("clear-pl")
    .setDescription(
      "Clear all PL from a member"
    )
    .addUserOption(
      option =>
        option
          .setName("member")
          .setDescription(
            "Member losing all PL"
          )
          .setRequired(true)
    ),
].map(
  command =>
    command
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .toJSON()
);

/* =========================================================
   PUBLIC COMMANDS
========================================================= */

const publicCommands = [
  new SlashCommandBuilder()
    .setName("broken-word")
    .setDescription(
      "Start a Broken Word game"
    ),

  new SlashCommandBuilder()
    .setName("precell")
    .setDescription(
      "Check your PL balance or another member's balance"
    )
    .addUserOption(
      option =>
        option
          .setName("member")
          .setDescription(
            "Member to check"
          )
          .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("give-pl")
    .setDescription(
      "Give PL to another member"
    )
    .addUserOption(
      option =>
        option
          .setName("member")
          .setDescription(
            "Member receiving PL"
          )
          .setRequired(true)
    )
    .addIntegerOption(
      option =>
        option
          .setName("amount")
          .setDescription(
            "Amount of PL"
          )
          .setRequired(true)
          .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("daily")
    .setDescription(
      "Claim your daily PL"
    ),

  new SlashCommandBuilder()
    .setName("side-job")
    .setDescription(
      "Complete a side job for PL"
    ),

  new SlashCommandBuilder()
    .setName("payment")
    .setDescription(
      "Receive a payment based on your reputation"
    ),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription(
      "Check the bot latency"
    ),
].map(
  command =>
    command.toJSON()
);

/* =========================================================
   COMMAND EXPORT
========================================================= */

const commands = [
  ...adminCommands,
  ...publicCommands,
];

/* =========================================================
   HANDLE COMMAND
========================================================= */

async function handleNewCommand(
  interaction,
  options = {}
) {
  if (
    !interaction.isChatInputCommand()
  ) {
    return false;
  }

  const {
    getReputation,
    addXP,
  } = options;

  /* =====================================================
     PING
  ===================================================== */

  if (
    interaction.commandName ===
    "ping"
  ) {
    await interaction.reply(
      "pong!🏓"
    );

    return true;
  }

  /* =====================================================
     PRECELL
  ===================================================== */

  if (
    interaction.commandName ===
    "precell"
  ) {
    const target =
      interaction.options.getUser(
        "member"
      ) ||
      interaction.user;

    const balance =
      getPL(
        interaction.guild.id,
        target.id
      );

    await interaction.reply({
      content:
        `${target} has **${formatPL(
          balance
        )}**.`,
      ephemeral: true,
    });

    return true;
  }

  /* =====================================================
     DAILY
  ===================================================== */

  if (
    interaction.commandName ===
    "daily"
  ) {
    const guildId =
      interaction.guild.id;

    const userId =
      interaction.user.id;

    if (
      !canClaimDaily(
        guildId,
        userId
      )
    ) {
      await interaction.reply({
        content:
          "You have already claimed your daily reward today. Come back tomorrow!",
        ephemeral: true,
      });

      return true;
    }

    claimDaily(
      guildId,
      userId
    );

    addPL(
      guildId,
      userId,
      1000
    );

    await interaction.reply({
      content:
        "You received **1,000 PL** from your daily reward!",
    });

    return true;
  }

  /* =====================================================
     SIDE JOB
  ===================================================== */

  if (
    interaction.commandName ===
    "side-job"
  ) {
    const remaining =
      cooldown(
        economyCooldowns,
        interaction.guild.id,
        interaction.user.id,
        "side-job",
        60 * 60 * 1000
      );

    if (remaining > 0) {
      await interaction.reply({
        content:
          `You can do another side job in ${Math.ceil(
            remaining / 60000
          )} minute(s).`,
        ephemeral: true,
      });

      return true;
    }

    const amount =
      randomBetween(
        600,
        1000
      );

    addPL(
      interaction.guild.id,
      interaction.user.id,
      amount
    );

    await interaction.reply({
      content:
        `You completed a side job and earned **${formatPL(
          amount
        )}**.`,
    });

    return true;
  }

  /* =====================================================
     PAYMENT
  ===================================================== */

  if (
    interaction.commandName ===
    "payment"
  ) {
    const remaining =
      cooldown(
        economyCooldowns,
        interaction.guild.id,
        interaction.user.id,
        "payment",
        60 * 60 * 1000
      );

    if (remaining > 0) {
      await interaction.reply({
        content:
          `You can request another payment in ${Math.ceil(
            remaining / 60000
          )} minute(s).`,
        ephemeral: true,
      });

      return true;
    }

    let reputation = 0;

    if (
      typeof getReputation ===
      "function"
    ) {
      reputation =
        await getReputation(
          interaction.guild.id,
          interaction.user.id
        );
    }

    const amount =
      calculatePayment(
        reputation
      );

    addPL(
      interaction.guild.id,
      interaction.user.id,
      amount
    );

    await interaction.reply({
      content:
        `Your reputation earned you **${formatPL(
          amount
        )}**.`,
    });

    return true;
  }

  /* =====================================================
     GIVE PL
  ===================================================== */

  if (
    interaction.commandName ===
    "give-pl"
  ) {
    const target =
      interaction.options.getUser(
        "member",
        true
      );

    const amount =
      interaction.options.getInteger(
        "amount",
        true
      );

    const senderBalance =
      getPL(
        interaction.guild.id,
        interaction.user.id
      );

    if (
      target.id ===
      interaction.user.id
    ) {
      await interaction.reply({
        content:
          "You cannot give PL to yourself.",
        ephemeral: true,
      });

      return true;
    }

    if (
      senderBalance <
      amount
    ) {
      await interaction.reply({
        content:
          "You do not have enough PL.",
        ephemeral: true,
      });

      return true;
    }

    removePL(
      interaction.guild.id,
      interaction.user.id,
      amount
    );

    addPL(
      interaction.guild.id,
      target.id,
      amount
    );

    await interaction.reply({
      content:
        `You gave **${formatPL(
          amount
        )}** to ${target}.`,
    });

    return true;
  }

  /* =====================================================
     BROKEN WORD
  ===================================================== */

  if (
    interaction.commandName ===
    "broken-word"
  ) {
    const existing =
      brokenWordGames.get(
        interaction.guild.id
      );

    if (
      existing &&
      !existing.winner &&
      Date.now() -
        existing.startedAt <
        60 * 1000
    ) {
      await interaction.reply({
        content:
          "There is already a Broken Word game running!",
        ephemeral: true,
      });

      return true;
    }

    const game =
      createBrokenWordGame(
        interaction.guild.id
      );

    await interaction.reply({
      content:
        `**Broken Word!**\n\nUnscramble this word:\n\n# \`${game.scrambled}\`\n\nFirst correct answer wins **2 PL**!`,
    });

    return true;
  }

  /* =====================================================
     ADMIN CHECK
  ===================================================== */

  const adminOnly = [
    "chairs",
    "mafia",
    "ttt",
    "hideNseek",
    "level-reward",
    "short",
    "add-pl",
    "take-pl",
    "clear-pl",
  ];

  if (
    adminOnly.includes(
      interaction.commandName
    )
  ) {
    if (
      !isModerator(
        interaction.member
      )
    ) {
      await interaction.reply({
        content:
          "You do not have permission to use this command.",
        ephemeral: true,
      });

      return true;
    }
  }

  /* =====================================================
     LEVEL REWARD
  ===================================================== */

  if (
    interaction.commandName ===
    "level-reward"
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

    const rewards =
      getGuildRewards(
        interaction.guild.id
      );

    rewards[String(level)] = {
      roleId: role.id,
    };

    save(
      REWARDS_FILE,
      levelRewards
    );

    await interaction.reply({
      content:
        `Members who reach **Level ${level}** will receive ${role}.`,
      ephemeral: true,
    });

    return true;
  }

  /* =====================================================
     SHORT
  ===================================================== */

  if (
    interaction.commandName ===
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
        .trim()
        .toLowerCase();

    if (
      !/^[a-z0-9-]+$/.test(
        shortcut
      )
    ) {
      await interaction.reply({
        content:
          "The shortcut can only contain letters, numbers, and hyphens.",
        ephemeral: true,
      });

      return true;
    }

    setShort(
      interaction.guild.id,
      command,
      shortcut
    );

    await interaction.reply({
      content:
        `The shortcut for **/${command}** is now **/${shortcut}**.`,
      ephemeral: true,
    });

    return true;
  }

  /* =====================================================
     OWNER PL COMMANDS
  ===================================================== */

  if (
    [
      "add-pl",
      "take-pl",
      "clear-pl",
    ].includes(
      interaction.commandName
    )
  ) {
    if (
      !isOwner(
        interaction.user.id
      )
    ) {
      await interaction.reply({
        content:
          "Only the bot owner can use this command.",
        ephemeral: true,
      });

      return true;
    }
  }

  if (
    interaction.commandName ===
    "add-pl"
  ) {
    const target =
      interaction.options.getUser(
        "member",
        true
      );

    const amount =
      interaction.options.getInteger(
        "amount",
        true
      );

    addPL(
      interaction.guild.id,
      target.id,
      amount
    );

    await interaction.reply({
      content:
        `Added **${formatPL(
          amount
        )}** to ${target}.`,
      ephemeral: true,
    });

    return true;
  }

  if (
    interaction.commandName ===
    "take-pl"
  ) {
    const target =
      interaction.options.getUser(
        "member",
        true
      );

    const amount =
      interaction.options.getInteger(
        "amount",
        true
      );

    removePL(
      interaction.guild.id,
      target.id,
      amount
    );

    await interaction.reply({
      content:
        `Removed **${formatPL(
          amount
        )}** from ${target}.`,
      ephemeral: true,
    });

    return true;
  }

  if (
    interaction.commandName ===
    "clear-pl"
  ) {
    const target =
      interaction.options.getUser(
        "member",
        true
      );

    setPL(
      interaction.guild.id,
      target.id,
      0
    );

    await interaction.reply({
      content:
        `All PL has been removed from ${target}.`,
      ephemeral: true,
    });

    return true;
  }

  /* =====================================================
     CHAIRS
  ===================================================== */

  if (
    interaction.commandName ===
    "chairs"
  ) {
    const existing =
      getChairsGame(
        interaction.guild.id
      );

    if (
      existing
    ) {
      await interaction.reply({
        content:
          "There is already a Chairs game running.",
        ephemeral: true,
      });

      return true;
    }

    const game =
      createChairsGame(
        interaction.guild.id,
        interaction.user.id
      );

    await interaction.reply({
      content:
        "A new **Chairs** game has been created.\n\nPlayers can register to join the game.",
    });

    return true;
  }

  /* =====================================================
     MAFIA
  ===================================================== */

  if (
    interaction.commandName ===
    "mafia"
  ) {
    const key =
      `${interaction.guild.id}:mafia`;

    if (
      games.has(key)
    ) {
      await interaction.reply({
        content:
          "There is already a Mafia game running.",
        ephemeral: true,
      });

      return true;
    }

    createMafiaGame(
      interaction.guild.id,
      interaction.user.id
    );

    await interaction.reply({
      content:
        "A new **Mafia** game has been created.\n\nPlayers can register to join.",
    });

    return true;
  }

  /* =====================================================
     TTT
  ===================================================== */

  if (
    interaction.commandName ===
    "ttt"
  ) {
    const key =
      `${interaction.guild.id}:ttt`;

    if (
      games.has(key)
    ) {
      await interaction.reply({
        content:
          "There is already a Tic Tac Toe game running.",
        ephemeral: true,
      });

      return true;
    }

    createTTTGame(
      interaction.guild.id,
      interaction.user.id
    );

    await interaction.reply({
      content:
        "A new **Tic Tac Toe** game has been created.",
    });

    return true;
  }

  /* =====================================================
     HIDE N SEEK
  ===================================================== */

  if (
    interaction.commandName ===
    "hideNseek"
  ) {
    const key =
      `${interaction.guild.id}:hideNseek`;

    if (
      games.has(key)
    ) {
      await interaction.reply({
        content:
          "There is already a Hide and Seek game running.",
        ephemeral: true,
      });

      return true;
    }

    createHideNSeekGame(
      interaction.guild.id,
      interaction.user.id
    );

    await interaction.reply({
      content:
        "A new **Hide and Seek** game has been created.\n\nPlayers can register to join.",
    });

    return true;
  }

  return false;
}

/* =========================================================
   BROKEN WORD MESSAGE HANDLER
========================================================= */

async function handleNewMessage(
  message
) {
  if (
    !message.guild ||
    message.author.bot
  ) {
    return false;
  }

  const game =
    brokenWordGames.get(
      message.guild.id
    );

  if (
    !game ||
    game.winner
  ) {
    return false;
  }

  if (
    Date.now() -
      game.startedAt >
    60 * 1000
  ) {
    brokenWordGames.delete(
      message.guild.id
    );

    return false;
  }

  if (
    message.content
      .trim()
      .toLowerCase() !==
    game.answer
  ) {
    return false;
  }

  game.winner =
    message.author.id;

  addPL(
    message.guild.id,
    message.author.id,
    2
  );

  await message.channel
    .send(
      `${message.author} got it first! The answer was **${game.answer}** and they won **2 PL**!`
    )
    .catch(
      () => {}
    );

  brokenWordGames.delete(
    message.guild.id
  );

  return true;
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  commands,

  adminCommands,

  publicCommands,

  handleNewCommand,

  handleNewMessage,

  getPL,

  setPL,

  addPL,

  removePL,

  formatPL,

  checkLevelRewards,

  getShort,

  setShort,

  calculatePayment,

  createChairsGame,

  createMafiaGame,

  createTTTGame,

  createHideNSeekGame,

  games,
};