const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

// ======================================================
// STORAGE
// ======================================================

const serverSettings = new Map();

function getGuildSettings(guildId) {
    if (!serverSettings.has(guildId)) {
        serverSettings.set(guildId, {
            antiSpam: {
                enabled: false,
                messages: 3,
                seconds: 3
            },

            punishment: {
                spam: {
                    type: "delete",
                    duration: null
                }
            },

            words: new Map(),

            customWords: new Map(),

            blockAnnouncement:
                "**your message have been blocked by the auto mod in {ServerName},**\n" +
                "please re-read the rules or contact staff if the word wasn't meant to be blocked!\n" +
                "{ServerName} auto mod"
        });
    }

    return serverSettings.get(guildId);
}

// ======================================================
// TIME PARSER
// Examples: 1m, 10m, 1h, 30s
// ======================================================

function parseDuration(input) {
    if (!input) return null;

    const match = input
        .toLowerCase()
        .trim()
        .match(/^(\d+)(s|m|h|d)$/);

    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2];

    const multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    };

    const milliseconds = amount * multipliers[unit];

    // Discord timeout maximum = 28 days
    if (milliseconds > 28 * 24 * 60 * 60 * 1000) {
        return null;
    }

    return milliseconds;
}

// ======================================================
// NORMALIZE TEXT
// Helps detect basic variations.
// ======================================================

function normalizeText(text) {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\u0600-\u06ff\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// ======================================================
// CHECK WORD
// ======================================================

function findBlockedWord(content, settings) {
    const normalized = normalizeText(content);

    // Custom words first because they have priority
    for (const [word, data] of settings.customWords) {
        const normalizedWord = normalizeText(word);

        if (
            normalized === normalizedWord ||
            normalized.includes(` ${normalizedWord} `) ||
            normalized.startsWith(`${normalizedWord} `) ||
            normalized.endsWith(` ${normalizedWord}`)
        ) {
            return {
                word,
                custom: true,
                ...data
            };
        }
    }

    // Normal blocked words
    for (const [word, data] of settings.words) {
        const normalizedWord = normalizeText(word);

        if (
            normalized === normalizedWord ||
            normalized.includes(` ${normalizedWord} `) ||
            normalized.startsWith(`${normalizedWord} `) ||
            normalized.endsWith(` ${normalizedWord}`)
        ) {
            return {
                word,
                custom: false,
                ...data
            };
        }
    }

    return null;
}

// ======================================================
// DM MESSAGE
// ======================================================

async function sendBlockDM(member, guild, settings, word, action) {
    try {
        let message = settings.blockAnnouncement;

        message = message.replaceAll("{ServerName}", guild.name);
        message = message.replaceAll("{User}", `<@${member.id}>`);
        message = message.replaceAll("{Word}", word);
        message = message.replaceAll("{Action}", action);

        await member.send(message);
    } catch (error) {
        // User may have DMs disabled
    }
}

// ======================================================
// APPLY PUNISHMENT
// ======================================================

async function applyPunishment(message, punishment, reason) {
    const member = message.member;

    if (!member) return;

    try {
        switch (punishment.type) {
            case "delete":
                await message.delete().catch(() => {});
                break;

            case "timeout":
                await message.delete().catch(() => {});

                if (!member.moderatable) return;

                await member.timeout(
                    punishment.duration,
                    reason
                );

                break;

            case "kick":
                await message.delete().catch(() => {});

                if (!member.kickable) return;

                await member.kick(reason);
                break;

            case "ban":
                await message.delete().catch(() => {});

                if (!member.bannable) return;

                await member.ban({
                    reason,
                    deleteMessageSeconds: 0
                });

                break;
        }
    } catch (error) {
        console.error("Punishment error:", error);
    }
}

// ======================================================
// SPAM TRACKER
// ======================================================

const spamTrackers = new Map();

function getUserSpamTracker(guildId, userId) {
    const key = `${guildId}:${userId}`;

    if (!spamTrackers.has(key)) {
        spamTrackers.set(key, []);
    }

    return spamTrackers.get(key);
}

function checkSpam(message, settings) {
    if (!settings.antiSpam.enabled) {
        return false;
    }

    const guildId = message.guild.id;
    const userId = message.author.id;

    const tracker = getUserSpamTracker(guildId, userId);

    const now = Date.now();

    tracker.push(now);

    const timeLimit =
        settings.antiSpam.seconds * 1000;

    while (
        tracker.length > 0 &&
        now - tracker[0] >= timeLimit
    ) {
        tracker.shift();
    }

    return (
        tracker.length >=
        settings.antiSpam.messages
    );
}

// ======================================================
// COMMANDS
// ======================================================

const commands = [

    // --------------------------------------------------
    // /anti-spam
    // --------------------------------------------------

    new SlashCommandBuilder()
        .setName("anti-spam")
        .setDescription("Configure Nexona's anti-spam system.")
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName("status")
                .setDescription("Turn anti-spam on or off.")
                .setRequired(false)
                .addChoices(
                    {
                        name: "On",
                        value: "on"
                    },
                    {
                        name: "Off",
                        value: "off"
                    }
                )
        )

        .addIntegerOption(option =>
            option
                .setName("messages")
                .setDescription("Number of messages required.")
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(5)
        )

        .addIntegerOption(option =>
            option
                .setName("seconds")
                .setDescription("Time window in seconds.")
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(5)
        ),

    // --------------------------------------------------
    // /punishment
    // --------------------------------------------------

    new SlashCommandBuilder()
        .setName("punishment")
        .setDescription("Configure AutoMod punishments.")
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName("action")
                .setDescription("What should the punishment apply to?")
                .setRequired(true)
                .addChoices({
                    name: "Spam",
                    value: "spam"
                })
        )

        .addStringOption(option =>
            option
                .setName("punishment")
                .setDescription("Choose the punishment.")
                .setRequired(true)
                .addChoices(
                    {
                        name: "Delete Message",
                        value: "delete"
                    },
                    {
                        name: "Timeout",
                        value: "timeout"
                    },
                    {
                        name: "Kick",
                        value: "kick"
                    },
                    {
                        name: "Ban",
                        value: "ban"
                    }
                )
        )

        .addStringOption(option =>
            option
                .setName("for")
                .setDescription("Timeout duration, e.g. 1m, 10m, 1h.")
                .setRequired(false)
        ),

    // --------------------------------------------------
    // /automod-word
    // --------------------------------------------------

    new SlashCommandBuilder()
        .setName("automod-word")
        .setDescription("Manage blocked AutoMod words.")
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addSubcommand(sub =>
            sub
                .setName("add")
                .setDescription("Add a blocked word.")
                .addStringOption(option =>
                    option
                        .setName("word")
                        .setDescription("Word to block.")
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName("action")
                        .setDescription("Action when the word is detected.")
                        .setRequired(false)
                        .addChoices(
                            {
                                name: "Delete",
                                value: "delete"
                            },
                            {
                                name: "Timeout",
                                value: "timeout"
                            }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName("for")
                        .setDescription("Timeout duration, e.g. 1m or 1h.")
                        .setRequired(false)
                )
        )

        .addSubcommand(sub =>
            sub
                .setName("remove")
                .setDescription("Remove a blocked word.")
                .addStringOption(option =>
                    option
                        .setName("word")
                        .setDescription("Word to remove.")
                        .setRequired(true)
                )
        )

        .addSubcommand(sub =>
            sub
                .setName("list")
                .setDescription("Show all blocked words.")
        ),

    // --------------------------------------------------
    // /custom-words
    // --------------------------------------------------

    new SlashCommandBuilder()
        .setName("custom-words")
        .setDescription("Give a blocked word a stronger punishment.")
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName("word")
                .setDescription("The word must already exist in AutoMod.")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("action")
                .setDescription("Choose the punishment.")
                .setRequired(true)
                .addChoices(
                    {
                        name: "Delete",
                        value: "delete"
                    },
                    {
                        name: "Timeout",
                        value: "timeout"
                    },
                    {
                        name: "Kick",
                        value: "kick"
                    },
                    {
                        name: "Ban",
                        value: "ban"
                    }
                )
        )

        .addStringOption(option =>
            option
                .setName("for")
                .setDescription("Timeout duration, e.g. 10m or 1h.")
                .setRequired(false)
        ),

    // --------------------------------------------------
    // /block-annc
    // --------------------------------------------------

    new SlashCommandBuilder()
        .setName("block-annc")
        .setDescription("Change the AutoMod blocked-message announcement.")
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("New DM message.")
                .setRequired(true)
        )
];

// ======================================================
// COMMAND HANDLER
// ======================================================

async function handleCommand(interaction) {
    if (!interaction.inGuild()) {
        return interaction.reply({
            content: "This command can only be used inside a server.",
            ephemeral: true
        });
    }

    if (
        !interaction.memberPermissions.has(
            PermissionFlagsBits.ManageMessages
        )
    ) {
        return interaction.reply({
            content: "You need the Manage Messages permission to use this command.",
            ephemeral: true
        });
    }

    const settings = getGuildSettings(
        interaction.guild.id
    );

    // ==================================================
    // ANTI-SPAM
    // ==================================================

    if (interaction.commandName === "anti-spam") {
        const status =
            interaction.options.getString("status");

        const messages =
            interaction.options.getInteger("messages");

        const seconds =
            interaction.options.getInteger("seconds");

        if (status !== null) {
            settings.antiSpam.enabled =
                status === "on";
        }

        if (messages !== null) {
            settings.antiSpam.messages =
                messages;
        }

        if (seconds !== null) {
            settings.antiSpam.seconds =
                seconds;
        }

        const statusText =
            settings.antiSpam.enabled
                ? "ON"
                : "OFF";

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle("Anti-Spam Updated")
                    .setDescription(
                        `Anti-Spam is now **${statusText}**.\n\n` +
                        `**Messages:** ${settings.antiSpam.messages}\n` +
                        `**Time:** ${settings.antiSpam.seconds} second(s)`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }

    // ==================================================
    // PUNISHMENT
    // ==================================================

    if (interaction.commandName === "punishment") {
        const action =
            interaction.options.getString("action");

        const punishment =
            interaction.options.getString("punishment");

        const durationInput =
            interaction.options.getString("for");

        let duration = null;

        if (punishment === "timeout") {
            if (!durationInput) {
                return interaction.reply({
                    content:
                        "You must provide a duration when using Timeout. Example: `10m` or `1h`.",
                    ephemeral: true
                });
            }

            duration =
                parseDuration(durationInput);

            if (!duration) {
                return interaction.reply({
                    content:
                        "Invalid duration. Use formats such as `30s`, `1m`, `10m`, `1h`, or `1d`. Maximum is 28 days.",
                    ephemeral: true
                });
            }
        }

        settings.punishment[action] = {
            type: punishment,
            duration
        };

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle("Punishment Updated")
                    .setDescription(
                        `**Action:** ${action}\n` +
                        `**Punishment:** ${punishment}\n` +
                        `**Duration:** ${
                            durationInput || "Not applicable"
                        }`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }

    // ==================================================
    // AUTOMOD WORD
    // ==================================================

    if (interaction.commandName === "automod-word") {
        const subcommand =
            interaction.options.getSubcommand();

        if (subcommand === "add") {
            const word =
                interaction.options.getString("word")
                    .trim()
                    .toLowerCase();

            const action =
                interaction.options.getString("action")
                || "delete";

            const durationInput =
                interaction.options.getString("for");

            let duration = null;

            if (action === "timeout") {
                if (!durationInput) {
                    return interaction.reply({
                        content:
                            "You must provide `for` when using Timeout. Example: `10m`.",
                        ephemeral: true
                    });
                }

                duration =
                    parseDuration(durationInput);

                if (!duration) {
                    return interaction.reply({
                        content:
                            "Invalid duration. Example: `1m`, `10m`, `1h`, `1d`.",
                        ephemeral: true
                    });
                }
            }

            settings.words.set(word, {
                type: action,
                duration
            });

            // If a custom rule existed, keep it because
            // custom punishment overrides normal punishment.
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("AutoMod Word Added")
                        .setDescription(
                            `**Word:** \`${word}\`\n` +
                            `**Action:** ${action}\n` +
                            `**Duration:** ${
                                durationInput || "Not applicable"
                            }`
                        )
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }

        if (subcommand === "remove") {
            const word =
                interaction.options.getString("word")
                    .trim()
                    .toLowerCase();

            if (!settings.words.has(word)) {
                return interaction.reply({
                    content:
                        `\`${word}\` is not in the AutoMod word list.`,
                    ephemeral: true
                });
            }

            settings.words.delete(word);

            // Custom rule must also disappear because
            // custom words are required to exist in AutoMod.
            settings.customWords.delete(word);

            return interaction.reply({
                content:
                    `Removed \`${word}\` from AutoMod.`,
                ephemeral: true
            });
        }

        if (subcommand === "list") {
            if (settings.words.size === 0) {
                return interaction.reply({
                    content:
                        "There are currently no blocked words.",
                    ephemeral: true
                });
            }

            const list = [];

            for (const [word, data] of settings.words) {
                list.push(
                    `• \`${word}\` → **${data.type}**${
                        data.duration
                            ? ` (${data.duration / 60000}m)`
                            : ""
                    }`
                );
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Nexona AutoMod Words")
                        .setDescription(list.join("\n"))
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }
    }

    // ==================================================
    // CUSTOM WORDS
    // ==================================================

    if (interaction.commandName === "custom-words") {
        const word =
            interaction.options.getString("word")
                .trim()
                .toLowerCase();

        if (!settings.words.has(word)) {
            return interaction.reply({
                content:
                    `\`${word}\` must already exist in \`/automod-word\` before you can make it a custom word.`,
                ephemeral: true
            });
        }

        const action =
            interaction.options.getString("action");

        const durationInput =
            interaction.options.getString("for");

        let duration = null;

        if (action === "timeout") {
            if (!durationInput) {
                return interaction.reply({
                    content:
                        "You must provide a duration for Timeout. Example: `1h`.",
                    ephemeral: true
                });
            }

            duration =
                parseDuration(durationInput);

            if (!duration) {
                return interaction.reply({
                    content:
                        "Invalid duration. Example: `1m`, `10m`, `1h`, `1d`.",
                    ephemeral: true
                });
            }
        }

        settings.customWords.set(word, {
            type: action,
            duration
        });

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle("Custom Word Updated")
                    .setDescription(
                        `**Word:** \`${word}\`\n` +
                        `**Punishment:** ${action}\n` +
                        `**Duration:** ${
                            durationInput || "Not applicable"
                        }`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }

    // ==================================================
    // BLOCK ANNOUNCEMENT
    // ==================================================

    if (interaction.commandName === "block-annc") {
        const message =
            interaction.options.getString("message");

        settings.blockAnnouncement =
            message;

        return interaction.reply({
            content:
                "The AutoMod blocked-message announcement has been updated.",
            ephemeral: true
        });
    }
}

// ======================================================
// MESSAGE HANDLER
// ======================================================

async function handleMessage(message) {
    if (!message.guild) return;

    if (message.author.bot) return;

    const settings =
        getGuildSettings(message.guild.id);

    // ==================================================
    // SPAM
    // ==================================================

    const spamDetected =
        checkSpam(message, settings);

    if (spamDetected) {
        const punishment =
            settings.punishment.spam;

        await applyPunishment(
            message,
            punishment,
            "Nexona AutoMod: Spam"
        );

        await sendBlockDM(
            message.member,
            message.guild,
            settings,
            "Spam",
            punishment.type
        );

        return;
    }

    // ==================================================
    // BLOCKED WORD
    // ==================================================

    const blocked =
        findBlockedWord(
            message.content,
            settings
        );

    if (!blocked) return;

    await applyPunishment(
        message,
        {
            type: blocked.type,
            duration: blocked.duration
        },
        `Nexona AutoMod: Blocked word (${blocked.word})`
    );

    await sendBlockDM(
        message.member,
        message.guild,
        settings,
        blocked.word,
        blocked.type
    );
}

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
    commands,
    handleCommand,
    handleMessage,
    getGuildSettings
};