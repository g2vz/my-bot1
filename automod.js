const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

// ======================================================
// SERVER SETTINGS
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
                "hello {user}.\n\n" +
                "your message ({word}) in {servername} have been {action}, " +
                "please re read the rules and contact staff if the message wasn't meant to be deleted"
        });
    }

    return serverSettings.get(guildId);
}

// ======================================================
// DURATION PARSER
// ======================================================
// Supported:
// 30s
// 1m
// 10m
// 1h
// 1d
//
// Maximum Discord timeout = 28 days
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

    const milliseconds =
        amount * multipliers[unit];

    // Discord maximum timeout
    if (
        milliseconds >
        28 * 24 * 60 * 60 * 1000
    ) {
        return null;
    }

    return milliseconds;
}

// ======================================================
// NORMALIZE MESSAGE
// ======================================================

function normalizeText(text) {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(
            /[^a-z0-9\u0600-\u06ff\s]/gi,
            " "
        )
        .replace(/\s+/g, " ")
        .trim();
}

// ======================================================
// FIND BLOCKED WORD
// ======================================================

function findBlockedWord(content, settings) {
    const normalized =
        normalizeText(content);

    // Custom words have priority
    for (
        const [word, data]
        of settings.customWords
    ) {
        const normalizedWord =
            normalizeText(word);

        if (
            normalized === normalizedWord ||
            normalized.includes(
                ` ${normalizedWord} `
            ) ||
            normalized.startsWith(
                `${normalizedWord} `
            ) ||
            normalized.endsWith(
                ` ${normalizedWord}`
            )
        ) {
            return {
                word,
                custom: true,
                ...data
            };
        }
    }

    // Normal AutoMod words
    for (
        const [word, data]
        of settings.words
    ) {
        const normalizedWord =
            normalizeText(word);

        if (
            normalized === normalizedWord ||
            normalized.includes(
                ` ${normalizedWord} `
            ) ||
            normalized.startsWith(
                `${normalizedWord} `
            ) ||
            normalized.endsWith(
                ` ${normalizedWord}`
            )
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
// SEND BLOCK DM
// ======================================================

async function sendBlockDM(
    member,
    guild,
    settings,
    word,
    action
) {
    try {
        let message =
            settings.blockAnnouncement;

        // ----------------------------------------------
        // VARIABLES
        // ----------------------------------------------

        message = message.replace(
            /\{user\}/gi,
            `<@${member.id}>`
        );

        message = message.replace(
            /\{word\}/gi,
            word
        );

        message = message.replace(
            /\{servername\}/gi,
            guild.name
        );

        message = message.replace(
            /\{action\}/gi,
            action
        );

        // ----------------------------------------------
        // EMBED
        // ----------------------------------------------

        const embed =
            new EmbedBuilder()
                .setTitle("Nexona AutoMod")
                .setDescription(message)
                .setFooter({
                    text: `${guild.name} auto mod`
                })
                .setTimestamp();

        await member.send({
            embeds: [embed]
        });

    } catch (error) {
        // User may have DMs disabled.
        console.log(
            `Could not send AutoMod DM to ${member.user?.tag || member.id}.`
        );
    }
}

// ======================================================
// APPLY PUNISHMENT
// ======================================================

async function applyPunishment(
    message,
    punishment,
    reason
) {
    const member =
        message.member;

    if (!member) return;

    try {
        switch (punishment.type) {

            // ------------------------------------------
            // DELETE
            // ------------------------------------------

            case "delete":

                await message
                    .delete()
                    .catch(() => {});

                break;

            // ------------------------------------------
            // TIMEOUT
            // ------------------------------------------

            case "timeout":

                await message
                    .delete()
                    .catch(() => {});

                if (!member.moderatable) {
                    console.log(
                        `Cannot timeout ${member.user.tag}`
                    );

                    return;
                }

                await member.timeout(
                    punishment.duration,
                    reason
                );

                break;

            // ------------------------------------------
            // KICK
            // ------------------------------------------

            case "kick":

                await message
                    .delete()
                    .catch(() => {});

                if (!member.kickable) {
                    console.log(
                        `Cannot kick ${member.user.tag}`
                    );

                    return;
                }

                await member.kick(
                    reason
                );

                break;

            // ------------------------------------------
            // BAN
            // ------------------------------------------

            case "ban":

                await message
                    .delete()
                    .catch(() => {});

                if (!member.bannable) {
                    console.log(
                        `Cannot ban ${member.user.tag}`
                    );

                    return;
                }

                await member.ban({
                    reason,
                    deleteMessageSeconds: 0
                });

                break;
        }

    } catch (error) {
        console.error(
            "Punishment error:",
            error
        );
    }
}

// ======================================================
// SPAM TRACKER
// ======================================================

const spamTrackers = new Map();

function getUserSpamTracker(
    guildId,
    userId
) {
    const key =
        `${guildId}:${userId}`;

    if (!spamTrackers.has(key)) {
        spamTrackers.set(
            key,
            []
        );
    }

    return spamTrackers.get(key);
}

// ======================================================
// CHECK SPAM
// ======================================================

function checkSpam(
    message,
    settings
) {
    if (
        !settings.antiSpam.enabled
    ) {
        return false;
    }

    const guildId =
        message.guild.id;

    const userId =
        message.author.id;

    const tracker =
        getUserSpamTracker(
            guildId,
            userId
        );

    const now =
        Date.now();

    tracker.push(now);

    const timeLimit =
        settings.antiSpam.seconds *
        1000;

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
// SLASH COMMANDS
// ======================================================

const commands = [

    // ==================================================
    // /anti-spam
    // ==================================================

    new SlashCommandBuilder()
        .setName("anti-spam")
        .setDescription(
            "Configure Nexona's anti-spam system."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName("status")
                .setDescription(
                    "Turn anti-spam on or off."
                )
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
                .setDescription(
                    "Number of messages required."
                )
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(5)
        )

        .addIntegerOption(option =>
            option
                .setName("seconds")
                .setDescription(
                    "Time window in seconds."
                )
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(5)
        ),

    // ==================================================
    // /punishment
    // ==================================================

    new SlashCommandBuilder()
        .setName("punishment")
        .setDescription(
            "Configure AutoMod punishments."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName("action")
                .setDescription(
                    "What should the punishment apply to?"
                )
                .setRequired(true)
                .addChoices({
                    name: "Spam",
                    value: "spam"
                })
        )

        .addStringOption(option =>
            option
                .setName("punishment")
                .setDescription(
                    "Choose the punishment."
                )
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
                .setDescription(
                    "Timeout duration. Examples: 1m, 10m, 1h."
                )
                .setRequired(false)
        ),

    // ==================================================
    // /automod-word
    // ==================================================

    new SlashCommandBuilder()
        .setName("automod-word")
        .setDescription(
            "Manage blocked AutoMod words."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        // ----------------------------------------------
        // ADD
        // ----------------------------------------------

        .addSubcommand(sub =>
            sub
                .setName("add")
                .setDescription(
                    "Add a blocked word."
                )

                .addStringOption(option =>
                    option
                        .setName("word")
                        .setDescription(
                            "Word to block."
                        )
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName("action")
                        .setDescription(
                            "Action when the word is detected."
                        )
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
                        .setDescription(
                            "Timeout duration. Example: 10m."
                        )
                        .setRequired(false)
                )
        )

        // ----------------------------------------------
        // REMOVE
        // ----------------------------------------------

        .addSubcommand(sub =>
            sub
                .setName("remove")
                .setDescription(
                    "Remove a blocked word."
                )

                .addStringOption(option =>
                    option
                        .setName("word")
                        .setDescription(
                            "Word to remove."
                        )
                        .setRequired(true)
                )
        )

        // ----------------------------------------------
        // LIST
        // ----------------------------------------------

        .addSubcommand(sub =>
            sub
                .setName("list")
                .setDescription(
                    "Show all blocked words."
                )
        ),

    // ==================================================
    // /custom-words
    // ==================================================

    new SlashCommandBuilder()
        .setName("custom-words")
        .setDescription(
            "Give a blocked word a stronger punishment."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName("word")
                .setDescription(
                    "The word must already exist in AutoMod."
                )
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("action")
                .setDescription(
                    "Choose the punishment."
                )
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
                .setDescription(
                    "Timeout duration. Example: 10m or 1h."
                )
                .setRequired(false)
        ),

    // ==================================================
    // /block-annc
    // ==================================================

    new SlashCommandBuilder()
        .setName("block-annc")
        .setDescription(
            "Change the AutoMod blocked-message DM."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName("message")
                .setDescription(
                    "Variables: {user} = member, {word} = blocked word, {servername} = server, {action} = action"
                )
                .setRequired(true)
        )
];

// ======================================================
// COMMAND HANDLER
// ======================================================

async function handleCommand(
    interaction
) {
    if (!interaction.inGuild()) {
        return interaction.reply({
            content:
                "This command can only be used inside a server.",
            ephemeral: true
        });
    }

    // ==================================================
    // PERMISSION CHECK
    // ==================================================

    if (
        !interaction.memberPermissions.has(
            PermissionFlagsBits.ManageMessages
        )
    ) {
        return interaction.reply({
            content:
                "You need the Manage Messages permission to use this command.",
            ephemeral: true
        });
    }

    const settings =
        getGuildSettings(
            interaction.guild.id
        );

    // ==================================================
    // /anti-spam
    // ==================================================

    if (
        interaction.commandName ===
        "anti-spam"
    ) {
        const status =
            interaction.options.getString(
                "status"
            );

        const messages =
            interaction.options.getInteger(
                "messages"
            );

        const seconds =
            interaction.options.getInteger(
                "seconds"
            );

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
                    .setTitle(
                        "Nexona Anti-Spam"
                    )
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
    // /punishment
    // ==================================================

    if (
        interaction.commandName ===
        "punishment"
    ) {
        const action =
            interaction.options.getString(
                "action"
            );

        const punishment =
            interaction.options.getString(
                "punishment"
            );

        const durationInput =
            interaction.options.getString(
                "for"
            );

        let duration = null;

        if (
            punishment ===
            "timeout"
        ) {
            if (!durationInput) {
                return interaction.reply({
                    content:
                        "You must provide a duration when using Timeout. Example: `10m` or `1h`.",
                    ephemeral: true
                });
            }

            duration =
                parseDuration(
                    durationInput
                );

            if (!duration) {
                return interaction.reply({
                    content:
                        "Invalid duration. Use `30s`, `1m`, `10m`, `1h`, or `1d`. Maximum is 28 days.",
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
                    .setTitle(
                        "Nexona Punishment"
                    )
                    .setDescription(
                        `**Action:** ${action}\n` +
                        `**Punishment:** ${punishment}\n` +
                        `**Duration:** ${
                            durationInput ||
                            "Not applicable"
                        }`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }

    // ==================================================
    // /automod-word
    // ==================================================

    if (
        interaction.commandName ===
        "automod-word"
    ) {
        const subcommand =
            interaction.options.getSubcommand();

        // ----------------------------------------------
        // ADD
        // ----------------------------------------------

        if (
            subcommand === "add"
        ) {
            const word =
                interaction.options
                    .getString("word")
                    .trim()
                    .toLowerCase();

            const action =
                interaction.options
                    .getString("action") ||
                "delete";

            const durationInput =
                interaction.options
                    .getString("for");

            let duration = null;

            if (
                action === "timeout"
            ) {
                if (!durationInput) {
                    return interaction.reply({
                        content:
                            "You must provide `for` when using Timeout. Example: `10m`.",
                        ephemeral: true
                    });
                }

                duration =
                    parseDuration(
                        durationInput
                    );

                if (!duration) {
                    return interaction.reply({
                        content:
                            "Invalid duration. Example: `1m`, `10m`, `1h`, or `1d`.",
                        ephemeral: true
                    });
                }
            }

            settings.words.set(
                word,
                {
                    type: action,
                    duration
                }
            );

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            "AutoMod Word Added"
                        )
                        .setDescription(
                            `**Word:** \`${word}\`\n` +
                            `**Action:** ${action}\n` +
                            `**Duration:** ${
                                durationInput ||
                                "Not applicable"
                            }`
                        )
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }

        // ----------------------------------------------
        // REMOVE
        // ----------------------------------------------

        if (
            subcommand === "remove"
        ) {
            const word =
                interaction.options
                    .getString("word")
                    .trim()
                    .toLowerCase();

            if (
                !settings.words.has(
                    word
                )
            ) {
                return interaction.reply({
                    content:
                        `\`${word}\` is not in the AutoMod word list.`,
                    ephemeral: true
                });
            }

            settings.words.delete(
                word
            );

            settings.customWords.delete(
                word
            );

            return interaction.reply({
                content:
                    `Removed \`${word}\` from AutoMod.`,
                ephemeral: true
            });
        }

        // ----------------------------------------------
        // LIST
        // ----------------------------------------------

        if (
            subcommand === "list"
        ) {
            if (
                settings.words.size ===
                0
            ) {
                return interaction.reply({
                    content:
                        "There are currently no blocked words.",
                    ephemeral: true
                });
            }

            const list = [];

            for (
                const [word, data]
                of settings.words
            ) {
                list.push(
                    `• \`${word}\` → **${data.type}**${
                        data.duration
                            ? ` (${Math.round(
                                data.duration /
                                60000
                            )}m)`
                            : ""
                    }`
                );
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            "Nexona AutoMod Words"
                        )
                        .setDescription(
                            list.join("\n")
                        )
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }
    }

    // ==================================================
    // /custom-words
    // ==================================================

    if (
        interaction.commandName ===
        "custom-words"
    ) {
        const word =
            interaction.options
                .getString("word")
                .trim()
                .toLowerCase();

        if (
            !settings.words.has(
                word
            )
        ) {
            return interaction.reply({
                content:
                    `\`${word}\` must already exist in \`/automod-word\` before you can make it a custom word.`,
                ephemeral: true
            });
        }

        const action =
            interaction.options
                .getString("action");

        const durationInput =
            interaction.options
                .getString("for");

        let duration = null;

        if (
            action === "timeout"
        ) {
            if (!durationInput) {
                return interaction.reply({
                    content:
                        "You must provide a duration for Timeout. Example: `1h`.",
                    ephemeral: true
                });
            }

            duration =
                parseDuration(
                    durationInput
                );

            if (!duration) {
                return interaction.reply({
                    content:
                        "Invalid duration. Example: `1m`, `10m`, `1h`, or `1d`.",
                    ephemeral: true
                });
            }
        }

        settings.customWords.set(
            word,
            {
                type: action,
                duration
            }
        );

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Custom Word Updated"
                    )
                    .setDescription(
                        `**Word:** \`${word}\`\n` +
                        `**Punishment:** ${action}\n` +
                        `**Duration:** ${
                            durationInput ||
                            "Not applicable"
                        }`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }

    // ==================================================
    // /block-annc
    // ==================================================

    if (
        interaction.commandName ===
        "block-annc"
    ) {
        const message =
            interaction.options
                .getString("message");

        settings.blockAnnouncement =
            message;

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Block Announcement Updated"
                    )
                    .setDescription(
                        "The AutoMod blocked-message DM has been updated successfully."
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }
}

// ======================================================
// MESSAGE HANDLER
// ======================================================

async function handleMessage(
    message
) {
    if (!message.guild) return;

    if (message.author.bot) return;

    const settings =
        getGuildSettings(
            message.guild.id
        );

    // ==================================================
    // SPAM
    // ==================================================

    const spamDetected =
        checkSpam(
            message,
            settings
        );

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