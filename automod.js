const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    AutoModerationRuleTriggerType,
    AutoModerationRuleEventType,
    AutoModerationActionType
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ============================================================
// NEXONA AUTOMOD
// ============================================================

const OWNER_ID = "1193602200644091957";

const DATA_FILE = path.join(
    __dirname,
    "automod.json"
);

const MAX_KEYWORDS = 1000;
const MAX_KEYWORD_LENGTH = 60;
const MAX_TIMEOUT = 2419200; // 28 days

const RULES = {
    delete: "NEXONA_WORD_DELETE",
    timeout: "NEXONA_WORD_TIMEOUT",
    kick: "NEXONA_WORD_KICK",
    ban: "NEXONA_WORD_BAN"
};

const OWNER_ROLE_NAME = "Nexona Owner";

// ============================================================
// DEFAULT DATA
// ============================================================

function defaultGuildData() {
    return {
        words: {},

        defaultPunishment: {
            actions: ["delete"],
            duration: null
        },

        customPunishments: {},

        antiSpam: {
            enabled: false,

            messages: 3,

            seconds: 3,

            punishment: {
                actions: ["delete"],
                duration: null
            },

            message: {
                location: "dm",
                action: "delete",
                action2: null
            },

            excludedChannels: [],

            bypassRoleId: null
        },

        blockAnnouncement:
            "hello {user}.\n\n" +
            "your message ({word}) in {servername} have been {action}, " +
            "please re read the rules and contact staff if the message wasn't meant to be deleted"
    };
}

// ============================================================
// DATABASE
// ============================================================

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify({}, null, 4)
        );
    }

    try {
        return JSON.parse(
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            )
        );
    } catch (error) {
        console.error(
            "Failed to read automod.json:",
            error
        );

        return {};
    }
}

function saveData(data) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
            data,
            null,
            4
        )
    );
}

const database = loadData();

function getGuildData(guildId) {
    if (!database[guildId]) {
        database[guildId] =
            defaultGuildData();

        saveData(database);
    }

    return database[guildId];
}

// ============================================================
// PERMISSIONS
// ============================================================

function isModerator(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageMessages
        )
    );
}

function isOwner(userId) {
    return userId === OWNER_ID;
}

// ============================================================
// DURATION
// ============================================================

function parseDuration(value) {
    if (!value) {
        return null;
    }

    const match =
        String(value)
            .trim()
            .toLowerCase()
            .match(
                /^(\d+)\s*(s|m|h|d)$/
            );

    if (!match) {
        return null;
    }

    const amount =
        Number(match[1]);

    const unit =
        match[2];

    const multiplier = {
        s: 1,
        m: 60,
        h: 3600,
        d: 86400
    }[unit];

    const seconds =
        amount * multiplier;

    if (
        seconds <= 0 ||
        seconds > MAX_TIMEOUT
    ) {
        return null;
    }

    return seconds;
}

function formatDuration(seconds) {
    if (!seconds) {
        return "N/A";
    }

    if (seconds % 86400 === 0) {
        return `${seconds / 86400}d`;
    }

    if (seconds % 3600 === 0) {
        return `${seconds / 3600}h`;
    }

    if (seconds % 60 === 0) {
        return `${seconds / 60}m`;
    }

    return `${seconds}s`;
}

// ============================================================
// PUNISHMENT
// ============================================================

function parsePunishment(
    first,
    second
) {
    const actions = [];

    if (first) {
        actions.push(
            first.toLowerCase()
        );
    }

    if (second) {
        actions.push(
            second.toLowerCase()
        );
    }

    const allowed = [
        "delete",
        "timeout",
        "kick",
        "ban"
    ];

    for (const action of actions) {
        if (
            !allowed.includes(
                action
            )
        ) {
            return {
                error:
                    `Invalid action \`${action}\`.`
            };
        }
    }

    // A blocked message is ALWAYS deleted.
    if (
        !actions.includes(
            "delete"
        )
    ) {
        actions.push(
            "delete"
        );
    }

    const unique =
        [...new Set(actions)];

    // Kick + Ban
    if (
        unique.includes("kick") &&
        unique.includes("ban")
    ) {
        return {
            error:
                "Kick and Ban cannot be used together."
        };
    }

    // Timeout + Kick/Ban
    if (
        unique.includes("timeout") &&
        (
            unique.includes("kick") ||
            unique.includes("ban")
        )
    ) {
        return {
            error:
                "Timeout cannot be combined with Kick or Ban."
        };
    }

    return {
        actions: unique
    };
}

function getPrimaryAction(actions) {
    if (
        actions.includes("ban")
    ) {
        return "ban";
    }

    if (
        actions.includes("kick")
    ) {
        return "kick";
    }

    if (
        actions.includes("timeout")
    ) {
        return "timeout";
    }

    return "delete";
}

// ============================================================
// OWNER AUTO-MOD BYPASS
// ============================================================

async function ensureOwnerRole(guild) {
    let role =
        guild.roles.cache.find(
            r =>
                r.name ===
                OWNER_ROLE_NAME
        );

    if (!role) {
        role =
            await guild.roles.create({
                name:
                    OWNER_ROLE_NAME,

                permissions: [],

                reason:
                    "Nexona AutoMod owner bypass"
            });
    }

    const owner =
        await guild.members
            .fetch(
                OWNER_ID
            )
            .catch(() => null);

    if (owner) {
        if (
            !owner.roles.cache.has(
                role.id
            )
        ) {
            await owner.roles.add(
                role,
                "Nexona owner AutoMod bypass"
            ).catch(() => {});
        }
    }

    return role;
}

// ============================================================
// AUTOMOD RULES
// ============================================================

async function getNexonaRules(guild) {
    const rules =
        await guild.autoModerationRules.fetch();

    return rules.filter(
        rule =>
            Object.values(
                RULES
            ).includes(
                rule.name
            )
    );
}

async function getRule(
    guild,
    action
) {
    const rules =
        await getNexonaRules(
            guild
        );

    return rules.find(
        rule =>
            rule.name ===
            RULES[action]
    );
}

// ============================================================
// BUILD DISCORD AUTOMOD ACTIONS
// ============================================================

function buildActions(
    action,
    duration
) {
    const actions = [];

    // Discord blocks the message before it is posted.
    actions.push({
        type:
            AutoModerationActionType.BlockMessage
    });

    // Discord handles timeout natively.
    if (
        action ===
        "timeout"
    ) {
        actions.push({
            type:
                AutoModerationActionType.Timeout,

            metadata: {
                durationSeconds:
                    duration || 60
            }
        });
    }

    return actions;
}

// ============================================================
// SYNC RULE
// ============================================================

async function syncRule(
    guild,
    action,
    words,
    duration
) {
    const ownerRole =
        await ensureOwnerRole(
            guild
        );

    const cleanWords =
        [
            ...new Set(
                words
                    .map(
                        word =>
                            String(word)
                                .trim()
                                .toLowerCase()
                    )
                    .filter(Boolean)
                    .filter(
                        word =>
                            word.length <=
                            MAX_KEYWORD_LENGTH
                    )
            )
        ];

    const existing =
        await getRule(
            guild,
            action
        );

    if (
        cleanWords.length ===
        0
    ) {
        if (existing) {
            await existing.delete(
                "Nexona AutoMod empty rule"
            );
        }

        return;
    }

    if (
        cleanWords.length >
        MAX_KEYWORDS
    ) {
        throw new Error(
            `${action} has more than ${MAX_KEYWORDS} valid words.`
        );
    }

    const options = {
        name:
            RULES[action],

        eventType:
            AutoModerationRuleEventType.MessageSend,

        triggerType:
            AutoModerationRuleTriggerType.Keyword,

        triggerMetadata: {
            keywordFilter:
                cleanWords
        },

        actions:
            buildActions(
                action,
                duration
            ),

        enabled:
            true,

        exemptRoles: [
            ownerRole.id
        ],

        reason:
            "Nexona AutoMod"
    };

    if (!existing) {
        await guild.autoModerationRules.create(
            options
        );
    } else {
        await existing.edit(
            options
        );
    }
}

// ============================================================
// REBUILD ALL WORD RULES
// ============================================================

async function rebuildWordRules(
    guild
) {
    const data =
        getGuildData(
            guild.id
        );

    const grouped = {
        delete: [],
        timeout: [],
        kick: [],
        ban: []
    };

    for (
        const [
            word,
            info
        ] of Object.entries(
            data.words
        )
    ) {
        const action =
            getPrimaryAction(
                info.actions
            );

        if (
            grouped[action]
        ) {
            grouped[action].push(
                word
            );
        }
    }

    const existing =
        await getNexonaRules(
            guild
        );

    for (
        const rule of existing
    ) {
        await rule.delete(
            "Nexona AutoMod rebuild"
        );
    }

    for (
        const action of [
            "delete",
            "timeout",
            "kick",
            "ban"
        ]
    ) {
        const duration =
            action === "timeout"
                ? (
                    data.words
                        ? getTimeoutDurationForWords(
                            data
                        )
                        : 60
                )
                : null;

        await syncRule(
            guild,
            action,
            grouped[action],
            duration
        );
    }
}

// ============================================================
// TIMEOUT DURATION FOR WORD RULE
// ============================================================

function getTimeoutDurationForWords(
    data
) {
    const timeoutWords =
        Object.values(
            data.words
        ).filter(
            info =>
                info.actions?.includes(
                    "timeout"
                )
        );

    const durations =
        timeoutWords
            .map(
                info =>
                    info.duration
            )
            .filter(Boolean);

    if (
        durations.length ===
        0
    ) {
        return 60;
    }

    // Discord AutoMod has one timeout duration per rule.
    // Therefore all normal timeout words use the current
    // default timeout duration.
    return data.defaultPunishment.duration || 60;
}

// ============================================================
// ADD MODAL
// ============================================================

function buildAddModal() {
    const modal =
        new ModalBuilder()
            .setCustomId(
                "nexona_automod_add_modal"
            )
            .setTitle(
                "Nexona AutoMod"
            );

    const input =
        new TextInputBuilder()
            .setCustomId(
                "words"
            )
            .setLabel(
                "Blocked words"
            )
            .setPlaceholder(
                "word1\nword2\nword3\nword4"
            )
            .setStyle(
                TextInputStyle.Paragraph
            )
            .setRequired(true)
            .setMaxLength(
                4000
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(
                input
            )
    );

    return modal;
}

// ============================================================
// REMOVE PAGE
// ============================================================

async function showRemovePage(
    interaction,
    page = 0
) {
    const data =
        getGuildData(
            interaction.guild.id
        );

    const words =
        Object.entries(
            data.words
        );

    if (
        words.length ===
        0
    ) {
        return interaction.reply({
            content:
                "There are no blocked words.",
            ephemeral: true
        });
    }

    const pageSize = 25;

    const totalPages =
        Math.ceil(
            words.length /
            pageSize
        );

    page =
        Math.max(
            0,
            Math.min(
                page,
                totalPages - 1
            )
        );

    const pageWords =
        words.slice(
            page * pageSize,
            (page + 1) *
                pageSize
        );

    const menu =
        new StringSelectMenuBuilder()
            .setCustomId(
                "nexona_automod_remove_select"
            )
            .setPlaceholder(
                "Select a blocked word to remove"
            )
            .addOptions(
                pageWords.map(
                    ([word, info]) =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(
                                word.slice(
                                    0,
                                    100
                                )
                            )
                            .setDescription(
                                `Action: ${getPrimaryAction(info.actions)}`
                            )
                            .setValue(
                                word
                            )
                )
            );

    const components = [
        new ActionRowBuilder()
            .addComponents(
                menu
            )
    ];

    const buttons = [];

    if (
        page > 0
    ) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(
                    `nexona_automod_remove_prev:${page - 1}`
                )
                .setLabel(
                    "Previous"
                )
                .setStyle(
                    ButtonStyle.Secondary
                )
        );
    }

    if (
        page <
        totalPages - 1
    ) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(
                    `nexona_automod_remove_next:${page + 1}`
                )
                .setLabel(
                    "Next"
                )
                .setStyle(
                    ButtonStyle.Secondary
                )
        );
    }

    if (
        buttons.length
    ) {
        components.push(
            new ActionRowBuilder()
                .addComponents(
                    buttons
                )
        );
    }

    const embed =
        new EmbedBuilder()
            .setTitle(
                "Nexona AutoMod"
            )
            .setDescription(
                `Select a word to remove.\n\nPage **${page + 1}/${totalPages}**`
            )
            .setTimestamp();

    if (
        interaction.replied ||
        interaction.deferred
    ) {
        return interaction.editReply({
            embeds: [embed],
            components
        });
    }

    return interaction.reply({
        embeds: [embed],
        components,
        ephemeral: true
    });
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [

    // ========================================================
    // AUTOMOD ADD
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "automod-add"
        )
        .setDescription(
            "Open a page where you can add blocked words."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        ),

    // ========================================================
    // AUTOMOD REMOVE
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "automod-remove"
        )
        .setDescription(
            "Open a page to remove a blocked word."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        ),

    // ========================================================
    // AUTOMOD LIST
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "automod-list"
        )
        .setDescription(
            "Show all blocked words and their actions."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        ),

    // ========================================================
    // PUNISHMENT
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "punishment"
        )
        .setDescription(
            "Set punishment actions."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "target"
                    )
                    .setDescription(
                        "What should this punishment apply to?"
                    )
                    .setRequired(true)
                    .addChoices(
                        {
                            name:
                                "Spam",
                            value:
                                "spam"
                        },
                        {
                            name:
                                "Blocked Words",
                            value:
                                "words"
                        }
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "action"
                    )
                    .setDescription(
                        "First punishment."
                    )
                    .setRequired(true)
                    .addChoices(
                        {
                            name:
                                "Timeout",
                            value:
                                "timeout"
                        },
                        {
                            name:
                                "Delete",
                            value:
                                "delete"
                        },
                        {
                            name:
                                "Kick",
                            value:
                                "kick"
                        },
                        {
                            name:
                                "Ban",
                            value:
                                "ban"
                        }
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "action2"
                    )
                    .setDescription(
                        "Optional second punishment."
                    )
                    .setRequired(false)
                    .addChoices(
                        {
                            name:
                                "Delete",
                            value:
                                "delete"
                        },
                        {
                            name:
                                "Timeout",
                            value:
                                "timeout"
                        },
                        {
                            name:
                                "Kick",
                            value:
                                "kick"
                        },
                        {
                            name:
                                "Ban",
                            value:
                                "ban"
                        }
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "for"
                    )
                    .setDescription(
                        "Timeout duration. Example: 5m, 10m, 1h, 1d."
                    )
                    .setRequired(false)
        ),

    // ========================================================
    // CUSTOM WORDS
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "custom-words"
        )
        .setDescription(
            "Set a custom punishment for one blocked word."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "word"
                    )
                    .setDescription(
                        "The word must already exist in /automod-add."
                    )
                    .setRequired(true)
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "action"
                    )
                    .setDescription(
                        "First punishment."
                    )
                    .setRequired(true)
                    .addChoices(
                        {
                            name:
                                "Timeout",
                            value:
                                "timeout"
                        },
                        {
                            name:
                                "Delete",
                            value:
                                "delete"
                        },
                        {
                            name:
                                "Kick",
                            value:
                                "kick"
                        },
                        {
                            name:
                                "Ban",
                            value:
                                "ban"
                        }
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "action2"
                    )
                    .setDescription(
                        "Optional second punishment."
                    )
                    .setRequired(false)
                    .addChoices(
                        {
                            name:
                                "Delete",
                            value:
                                "delete"
                        },
                        {
                            name:
                                "Timeout",
                            value:
                                "timeout"
                        },
                        {
                            name:
                                "Kick",
                            value:
                                "kick"
                        },
                        {
                            name:
                                "Ban",
                            value:
                                "ban"
                        }
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "for"
                    )
                    .setDescription(
                        "Timeout duration. Example: 5m, 10m, 1h, 1d."
                    )
                    .setRequired(false)
        ),

    // ========================================================
    // BLOCK ANNOUNCEMENT
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "block-annc"
        )
        .setDescription(
            "Customize the blocked-message DM."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "message"
                    )
                    .setDescription(
                        "Variables: {user} {word} {servername} {action}"
                    )
                    .setRequired(true)
        ),

    // ========================================================
    // ANTI SPAM
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "anti-spam"
        )
        .setDescription(
            "Configure Nexona anti-spam."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "status"
                    )
                    .setDescription(
                        "Turn anti-spam on or off."
                    )
                    .setRequired(false)
                    .addChoices(
                        {
                            name:
                                "On",
                            value:
                                "on"
                        },
                        {
                            name:
                                "Off",
                            value:
                                "off"
                        }
                    )
        )
        .addIntegerOption(
            option =>
                option
                    .setName(
                        "messages"
                    )
                    .setDescription(
                        "Number of messages required."
                    )
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(5)
        )
        .addIntegerOption(
            option =>
                option
                    .setName(
                        "seconds"
                    )
                    .setDescription(
                        "Time window in seconds."
                    )
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(5)
        ),

    // ========================================================
    // SPAM MESSAGE
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "spam-message"
        )
        .setDescription(
            "Customize the anti-spam warning."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "location"
                    )
                    .setDescription(
                        "Where should the warning be sent?"
                    )
                    .setRequired(true)
                    .addChoices(
                        {
                            name:
                                "DM",
                            value:
                                "dm"
                        },
                        {
                            name:
                                "Chat",
                            value:
                                "channel"
                        }
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "action"
                    )
                    .setDescription(
                        "Action shown in the warning."
                    )
                    .setRequired(false)
                    .addChoices(
                        {
                            name:
                                "Delete",
                            value:
                                "delete"
                        },
                        {
                            name:
                                "Timeout",
                            value:
                                "timeout"
                        },
                        {
                            name:
                                "Kick",
                            value:
                                "kick"
                        },
                        {
                            name:
                                "Ban",
                            value:
                                "ban"
                        }
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "action2"
                    )
                    .setDescription(
                        "Optional second action shown in the warning."
                    )
                    .setRequired(false)
                    .addChoices(
                        {
                            name:
                                "Delete",
                            value:
                                "delete"
                        },
                        {
                            name:
                                "Timeout",
                            value:
                                "timeout"
                        },
                        {
                            name:
                                "Kick",
                            value:
                                "kick"
                        },
                        {
                            name:
                                "Ban",
                            value:
                                "ban"
                        }
                    )
        ),

    // ========================================================
    // SPAM CHANNEL
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "spam-channel"
        )
        .setDescription(
            "Enable or disable anti-spam in a channel."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addChannelOption(
            option =>
                option
                    .setName(
                        "channel"
                    )
                    .setDescription(
                        "Channel to configure."
                    )
                    .setRequired(true)
                    .addChannelTypes(
                        ChannelType.GuildText,
                        ChannelType.GuildAnnouncement,
                        ChannelType.PublicThread,
                        ChannelType.PrivateThread
                    )
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "status"
                    )
                    .setDescription(
                        "Should anti-spam work in this channel?"
                    )
                    .setRequired(true)
                    .addChoices(
                        {
                            name:
                                "On",
                            value:
                                "on"
                        },
                        {
                            name:
                                "Off",
                            value:
                                "off"
                        }
                    )
        ),

    // ========================================================
    // BYPASS ANTI SPAM
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "bypass-antispam"
        )
        .setDescription(
            "Set a role that bypasses anti-spam."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addRoleOption(
            option =>
                option
                    .setName(
                        "role"
                    )
                    .setDescription(
                        "Role that bypasses anti-spam."
                    )
                    .setRequired(true)
        )
];

// ============================================================
// BLOCK MESSAGE TEMPLATE
// ============================================================

function buildBlockMessage(
    template,
    member,
    guild,
    word,
    action
) {
    return String(template)
        .replace(
            /\{user\}/gi,
            `<@${member.id}>`
        )
        .replace(
            /\{word\}/gi,
            word
        )
        .replace(
            /\{servername\}/gi,
            guild.name
        )
        .replace(
            /\{action\}/gi,
            action
        );
}

// ============================================================
// SEND BLOCK DM
// ============================================================

async function sendBlockDM(
    execution
) {
    const guild =
        execution.guild;

    if (!guild) {
        return;
    }

    if (
        isOwner(
            execution.userId
        )
    ) {
        return;
    }

    const member =
        await guild.members
            .fetch(
                execution.userId
            )
            .catch(() => null);

    if (!member) {
        return;
    }

    const data =
        getGuildData(
            guild.id
        );

    const ruleName =
        execution.autoModerationRule
            ?.name;

    let action =
        "delete";

    if (
        ruleName ===
        RULES.timeout
    ) {
        action =
            "timeout";
    }

    if (
        ruleName ===
        RULES.kick
    ) {
        action =
            "kick";
    }

    if (
        ruleName ===
        RULES.ban
    ) {
        action =
            "ban";
    }

    const word =
        execution.matchedKeyword ||
        "blocked word";

    const message =
        buildBlockMessage(
            data.blockAnnouncement,
            member,
            guild,
            word,
            action
        );

    const embed =
        new EmbedBuilder()
            .setTitle(
                "Nexona AutoMod"
            )
            .setDescription(
                message
            )
            .setFooter({
                text:
                    `${guild.name} auto mod`
            })
            .setTimestamp();

    await member
        .send({
            embeds: [
                embed
            ]
        })
        .catch(() => {});
}

// ============================================================
// KICK / BAN
// ============================================================

async function executeExternalPunishment(
    execution
) {
    const guild =
        execution.guild;

    if (!guild) {
        return;
    }

    if (
        isOwner(
            execution.userId
        )
    ) {
        return;
    }

    const member =
        await guild.members
            .fetch(
                execution.userId
            )
            .catch(() => null);

    if (!member) {
        return;
    }

    const ruleName =
        execution.autoModerationRule
            ?.name;

    if (
        ruleName ===
        RULES.kick
    ) {
        if (
            member.kickable
        ) {
            await member
                .kick(
                    "Nexona AutoMod"
                )
                .catch(() => {});
        }

        return;
    }

    if (
        ruleName ===
        RULES.ban
    ) {
        if (
            member.bannable
        ) {
            await member
                .ban({
                    reason:
                        "Nexona AutoMod"
                })
                .catch(() => {});
        }
    }
}

// ============================================================
// ANTI SPAM TRACKER
// ============================================================

const spamTracker =
    new Map();

function getSpamTracker(
    guildId,
    userId
) {
    const key =
        `${guildId}:${userId}`;

    if (
        !spamTracker.has(
            key
        )
    ) {
        spamTracker.set(
            key,
            []
        );
    }

    return spamTracker.get(
        key
    );
}

// ============================================================
// SPAM MESSAGE
// ============================================================

async function sendSpamMessage(
    message,
    data
) {
    const config =
        data.antiSpam.message;

    const actions = [
        config.action,
        config.action2
    ]
        .filter(Boolean)
        .join(" + ");

    const embed =
        new EmbedBuilder()
            .setTitle(
                "Nexona Anti-Spam"
            )
            .setDescription(
                "Your message was blocked because you were sending messages too quickly."
            )
            .addFields({
                name:
                    "Action",
                value:
                    actions ||
                    "delete",
                inline:
                    true
            })
            .setFooter({
                text:
                    `${message.guild.name} auto mod`
            })
            .setTimestamp();

    if (
        config.location ===
        "dm"
    ) {
        await message.author
            .send({
                embeds: [
                    embed
                ]
            })
            .catch(() => {});

        return;
    }

    await message.channel
        .send({
            content:
                `<@${message.author.id}>`,
            embeds: [
                embed
            ]
        })
        .catch(() => {});
}

// ============================================================
// HANDLE MESSAGE
// ============================================================

async function handleMessage(
    message
) {
    if (
        !message.guild ||
        message.author.bot
    ) {
        return;
    }

    // Owner is NEVER affected by Nexona anti-spam.
    if (
        isOwner(
            message.author.id
        )
    ) {
        return;
    }

    const data =
        getGuildData(
            message.guild.id
        );

    const spam =
        data.antiSpam;

    if (
        !spam.enabled
    ) {
        return;
    }

    // Excluded channel.
    if (
        spam.excludedChannels.includes(
            message.channel.id
        )
    ) {
        return;
    }

    // Bypass role.
    if (
        spam.bypassRoleId &&
        message.member?.roles.cache.has(
            spam.bypassRoleId
        )
    ) {
        return;
    }

    const tracker =
        getSpamTracker(
            message.guild.id,
            message.author.id
        );

    const now =
        Date.now();

    tracker.push(
        now
    );

    const windowMs =
        spam.seconds *
        1000;

    while (
        tracker.length &&
        now -
            tracker[0] >=
            windowMs
    ) {
        tracker.shift();
    }

    if (
        tracker.length <
        spam.messages
    ) {
        return;
    }

    // Reset after triggering.
    tracker.length = 0;

    // Delete the spam message.
    await message
        .delete()
        .catch(() => {});

    const punishment =
        spam.punishment;

    // Timeout.
    if (
        punishment.actions.includes(
            "timeout"
        )
    ) {
        if (
            message.member?.moderatable
        ) {
            await message.member
                .timeout(
                    punishment.duration ||
                    60,
                    "Nexona Anti-Spam"
                )
                .catch(() => {});
        }
    }

    // Kick.
    if (
        punishment.actions.includes(
            "kick"
        )
    ) {
        if (
            message.member?.kickable
        ) {
            await message.member
                .kick(
                    "Nexona Anti-Spam"
                )
                .catch(() => {});
        }
    }

    // Ban.
    if (
        punishment.actions.includes(
            "ban"
        )
    ) {
        if (
            message.member?.bannable
        ) {
            await message.member
                .ban({
                    reason:
                        "Nexona Anti-Spam"
                })
                .catch(() => {});
        }
    }

    await sendSpamMessage(
        message,
        data
    );
}

// ============================================================
// COMMAND HANDLER
// ============================================================

async function handleCommand(
    interaction
) {
    if (
        !interaction.isChatInputCommand()
    ) {
        return;
    }

    if (
        !interaction.guild
    ) {
        return interaction.reply({
            content:
                "This command can only be used inside a server.",
            ephemeral:
                true
        });
    }

    if (
        !isModerator(
            interaction
        )
    ) {
        return interaction.reply({
            content:
                "You need the Manage Messages permission.",
            ephemeral:
                true
        });
    }

    const data =
        getGuildData(
            interaction.guild.id
        );

    // ========================================================
    // AUTOMOD ADD
    // ========================================================

    if (
        interaction.commandName ===
        "automod-add"
    ) {
        return interaction.showModal(
            buildAddModal()
        );
    }

    // ========================================================
    // AUTOMOD REMOVE
    // ========================================================

    if (
        interaction.commandName ===
        "automod-remove"
    ) {
        return showRemovePage(
            interaction,
            0
        );
    }

    // ========================================================
    // AUTOMOD LIST
    // ========================================================

    if (
        interaction.commandName ===
        "automod-list"
    ) {
        const groups = {
            delete: [],
            timeout: [],
            kick: [],
            ban: []
        };

        for (
            const [
                word,
                info
            ] of Object.entries(
                data.words
            )
        ) {
            const action =
                getPrimaryAction(
                    info.actions
                );

            groups[action].push(
                word
            );
        }

        let description =
            `list of ${interaction.guild.name}'s blocked messages\n\n`;

        for (
            const action of [
                "delete",
                "timeout",
                "kick",
                "ban"
            ]
        ) {
            if (
                groups[action]
                    .length === 0
            ) {
                continue;
            }

            description +=
                `**\`action: ${action}\`**\n`;

            description +=
                groups[action]
                    .map(
                        word =>
                            `\`${word}\``
                    )
                    .join("\n");

            description +=
                "\n\n";
        }

        description +=
            `**${interaction.guild.name}**`;

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        `list of ${interaction.guild.name}'s blocked messages`
                    )
                    .setDescription(
                        description
                    )
                    .setTimestamp()
            ],
            ephemeral:
                true
        });
    }

    // ========================================================
    // PUNISHMENT
    // ========================================================

    if (
        interaction.commandName ===
        "punishment"
    ) {
        const target =
            interaction.options
                .getString(
                    "target"
                );

        const first =
            interaction.options
                .getString(
                    "action"
                );

        const second =
            interaction.options
                .getString(
                    "action2"
                );

        const durationText =
            interaction.options
                .getString(
                    "for"
                );

        const parsed =
            parsePunishment(
                first,
                second
            );

        if (
            parsed.error
        ) {
            return interaction.reply({
                content:
                    parsed.error,
                ephemeral:
                    true
            });
        }

        const actions =
            parsed.actions;

        let duration =
            null;

        if (
            actions.includes(
                "timeout"
            )
        ) {
            if (
                !durationText
            ) {
                return interaction.reply({
                    content:
                        "Timeout requires `for`. Example: `for: 5m`.",
                    ephemeral:
                        true
                });
            }

            duration =
                parseDuration(
                    durationText
                );

            if (
                !duration
            ) {
                return interaction.reply({
                    content:
                        "Invalid timeout. Use 30s, 1m, 5m, 1h, 1d, etc. Maximum is 28 days.",
                    ephemeral:
                        true
                });
            }
        }

        // ----------------------------------------------------
        // SPAM
        // ----------------------------------------------------

        if (
            target ===
            "spam"
        ) {
            data.antiSpam
                .punishment = {
                    actions,
                    duration
                };

            saveData(
                database
            );

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            "Nexona Spam Punishment"
                        )
                        .setDescription(
                            `**Actions:** ${actions.join(" + ")}\n` +
                            `**Duration:** ${formatDuration(duration)}`
                        )
                        .setTimestamp()
                ],
                ephemeral:
                    true
            });
        }

        // ----------------------------------------------------
        // WORDS
        // ----------------------------------------------------

        if (
            target ===
            "words"
        ) {
            data.defaultPunishment = {
                actions,
                duration
            };

            for (
                const [
                    word
                ] of Object.entries(
                    data.words
                )
            ) {
                // Custom words keep their custom punishment.
                if (
                    data.customPunishments[word]
                ) {
                    continue;
                }

                data.words[word] = {
                    actions:
                        [...actions],

                    duration
                };
            }

            saveData(
                database
            );

            try {
                await rebuildWordRules(
                    interaction.guild
                );
            } catch (error) {
                console.error(
                    "Punishment rebuild error:",
                    error
                );

                return interaction.reply({
                    content:
                        `The punishment was saved, but Discord AutoMod could not be updated.\n\n${error.message}`,
                    ephemeral:
                        true
                });
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            "Nexona AutoMod Punishment"
                        )
                        .setDescription(
                            `**Actions:** ${actions.join(" + ")}\n` +
                            `**Duration:** ${formatDuration(duration)}`
                        )
                        .setTimestamp()
                ],
                ephemeral:
                    true
            });
        }
    }

    // ========================================================
    // CUSTOM WORDS
    // ========================================================

    if (
        interaction.commandName ===
        "custom-words"
    ) {
        const word =
            interaction.options
                .getString(
                    "word"
                )
                .trim()
                .toLowerCase();

        if (
            !data.words[word]
        ) {
            return interaction.reply({
                content:
                    `\`${word}\` does not exist. Add it first using /automod-add.`,
                ephemeral:
                    true
            });
        }

        const first =
            interaction.options
                .getString(
                    "action"
                );

        const second =
            interaction.options
                .getString(
                    "action2"
                );

        const durationText =
            interaction.options
                .getString(
                    "for"
                );

        const parsed =
            parsePunishment(
                first,
                second
            );

        if (
            parsed.error
        ) {
            return interaction.reply({
                content:
                    parsed.error,
                ephemeral:
                    true
            });
        }

        let duration =
            null;

        if (
            parsed.actions.includes(
                "timeout"
            )
        ) {
            if (
                !durationText
            ) {
                return interaction.reply({
                    content:
                        "Timeout requires `for`. Example: `for: 5m`.",
                    ephemeral:
                        true
                });
            }

            duration =
                parseDuration(
                    durationText
                );

            if (
                !duration
            ) {
                return interaction.reply({
                    content:
                        "Invalid timeout duration.",
                    ephemeral:
                        true
                });
            }
        }

        data.words[word] = {
            actions:
                parsed.actions,

            duration
        };

        data.customPunishments[word] = {
            actions:
                parsed.actions,

            duration
        };

        saveData(
            database
        );

        try {
            await rebuildWordRules(
                interaction.guild
            );
        } catch (error) {
            console.error(
                "Custom word rebuild error:",
                error
            );

            return interaction.reply({
                content:
                    `The custom punishment was saved, but Discord AutoMod could not be updated.\n\n${error.message}`,
                ephemeral:
                    true
            });
        }

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Custom Word"
                    )
                    .setDescription(
                        `\`${word}\`\n\n` +
                        `**Action:** ${parsed.actions.join(" + ")}\n` +
                        `**Duration:** ${formatDuration(duration)}`
                    )
                    .setTimestamp()
            ],
            ephemeral:
                true
        });
    }

    // ========================================================
    // BLOCK ANNC
    // ========================================================

    if (
        interaction.commandName ===
        "block-annc"
    ) {
        const message =
            interaction.options
                .getString(
                    "message"
                );

        data.blockAnnouncement =
            message;

        saveData(
            database
        );

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona AutoMod"
                    )
                    .setDescription(
                        "The blocked-message DM has been updated."
                    )
                    .addFields({
                        name:
                            "Available variables",
                        value:
                            "`{user}`\n" +
                            "`{word}`\n" +
                            "`{servername}`\n" +
                            "`{action}`"
                    })
                    .setTimestamp()
            ],
            ephemeral:
                true
        });
    }

    // ========================================================
    // ANTI SPAM
    // ========================================================

    if (
        interaction.commandName ===
        "anti-spam"
    ) {
        const status =
            interaction.options
                .getString(
                    "status"
                );

        const messages =
            interaction.options
                .getInteger(
                    "messages"
                );

        const seconds =
            interaction.options
                .getInteger(
                    "seconds"
                );

        if (
            status !==
            null
        ) {
            data.antiSpam.enabled =
                status ===
                "on";
        }

        if (
            messages !==
            null
        ) {
            data.antiSpam.messages =
                messages;
        }

        if (
            seconds !==
            null
        ) {
            data.antiSpam.seconds =
                seconds;
        }

        saveData(
            database
        );

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Anti-Spam"
                    )
                    .setDescription(
                        `**Status:** ${data.antiSpam.enabled ? "ON" : "OFF"}\n` +
                        `**Messages:** ${data.antiSpam.messages}\n` +
                        `**Seconds:** ${data.antiSpam.seconds}`
                    )
                    .setTimestamp()
            ],
            ephemeral:
                true
        });
    }

    // ========================================================
    // SPAM MESSAGE
    // ========================================================

    if (
        interaction.commandName ===
        "spam-message"
    ) {
        const location =
            interaction.options
                .getString(
                    "location"
                );

        const action =
            interaction.options
                .getString(
                    "action"
                );

        const action2 =
            interaction.options
                .getString(
                    "action2"
                );

        data.antiSpam.message = {
            location,

            action:
                action ||
                "delete",

            action2:
                action2 ||
                null
        };

        saveData(
            database
        );

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Spam Message"
                    )
                    .setDescription(
                        `**Location:** ${location}\n` +
                        `**Action:** ${action || "delete"}\n` +
                        `**Action 2:** ${action2 || "None"}`
                    )
                    .setTimestamp()
            ],
            ephemeral:
                true
        });
    }

    // ========================================================
    // SPAM CHANNEL
    // ========================================================

    if (
        interaction.commandName ===
        "spam-channel"
    ) {
        const channel =
            interaction.options
                .getChannel(
                    "channel"
                );

        const status =
            interaction.options
                .getString(
                    "status"
                );

        const list =
            data.antiSpam
                .excludedChannels;

        if (
            status ===
            "off"
        ) {
            if (
                !list.includes(
                    channel.id
                )
            ) {
                list.push(
                    channel.id
                );
            }
        } else {
            data.antiSpam
                .excludedChannels =
                list.filter(
                    id =>
                        id !==
                        channel.id
                );
        }

        saveData(
            database
        );

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Spam Channel"
                    )
                    .setDescription(
                        status === "off"
                            ? `${channel} is now excluded from anti-spam.`
                            : `${channel} is now enabled for anti-spam.`
                    )
                    .setTimestamp()
            ],
            ephemeral:
                true
        });
    }

    // ========================================================
    // BYPASS ANTI SPAM
    // ========================================================

    if (
        interaction.commandName ===
        "bypass-antispam"
    ) {
        const role =
            interaction.options
                .getRole(
                    "role"
                );

        data.antiSpam
            .bypassRoleId =
            role.id;

        saveData(
            database
        );

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Anti-Spam"
                    )
                    .setDescription(
                        `${role} can now bypass anti-spam.`
                    )
                    .setTimestamp()
            ],
            ephemeral:
                true
        });
    }
}

// ============================================================
// INSTALL EVENTS
// ============================================================

function install(client) {
    if (
        client.__nexonaAutomodInstalled
    ) {
        return;
    }

    client.__nexonaAutomodInstalled =
        true;

    // ========================================================
    // INTERACTIONS
    // ========================================================

    client.on(
        "interactionCreate",
        async interaction => {
            try {

                // ================================================
                // MODAL
                // ================================================

                if (
                    interaction.isModalSubmit()
                ) {
                    if (
                        interaction.customId ===
                        "nexona_automod_add_modal"
                    ) {
                        if (
                            !interaction.guild ||
                            !isModerator(
                                interaction
                            )
                        ) {
                            return;
                        }

                        const data =
                            getGuildData(
                                interaction.guild.id
                            );

                        const input =
                            interaction.fields
                                .getTextInputValue(
                                    "words"
                                );

                        const words =
                            input
                                .split(
                                    /[\n,]+/
                                )
                                .map(
                                    word =>
                                        word
                                            .trim()
                                            .toLowerCase()
                                )
                                .filter(Boolean);

                        let added = 0;
                        let skipped = 0;
                        let invalid = 0;

                        for (
                            const word
                            of words
                        ) {
                            if (
                                word.length >
                                MAX_KEYWORD_LENGTH
                            ) {
                                invalid++;
                                continue;
                            }

                            if (
                                data.words[word]
                            ) {
                                skipped++;
                                continue;
                            }

                            data.words[word] = {
                                actions:
                                    [
                                        ...data
                                            .defaultPunishment
                                            .actions
                                    ],

                                duration:
                                    data
                                        .defaultPunishment
                                        .duration
                            };

                            added++;
                        }

                        saveData(
                            database
                        );

                        try {
                            await rebuildWordRules(
                                interaction.guild
                            );
                        } catch (error) {
                            console.error(
                                "AutoMod rebuild error:",
                                error
                            );

                            return interaction.reply({
                                content:
                                    `Words were saved, but Discord AutoMod could not update the rules.\n\n${error.message}`,
                                ephemeral:
                                    true
                            });
                        }

                        return interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle(
                                        "Nexona AutoMod"
                                    )
                                    .setDescription(
                                        `Added **${added}** word(s).\n` +
                                        `Skipped **${skipped}** existing word(s).\n` +
                                        `Invalid/too-long **${invalid}** word(s).`
                                    )
                                    .setTimestamp()
                            ],
                            ephemeral:
                                true
                        });
                    }

                    return;
                }

                // ================================================
                // SELECT MENU
                // ================================================

                if (
                    interaction.isStringSelectMenu()
                ) {
                    if (
                        interaction.customId ===
                        "nexona_automod_remove_select"
                    ) {
                        if (
                            !isModerator(
                                interaction
                            )
                        ) {
                            return interaction.reply({
                                content:
                                    "You need Manage Messages.",
                                ephemeral:
                                    true
                            });
                        }

                        const word =
                            interaction.values[0];

                        const data =
                            getGuildData(
                                interaction.guild.id
                            );

                        delete data.words[word];

                        delete data.customPunishments?.[
                            word
                        ];

                        saveData(
                            database
                        );

                        await rebuildWordRules(
                            interaction.guild
                        );

                        return interaction.update({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle(
                                        "Nexona AutoMod"
                                    )
                                    .setDescription(
                                        `Removed \`${word}\` from the blocked words.`
                                    )
                                    .setTimestamp()
                            ],
                            components: []
                        });
                    }

                    return;
                }

                // ================================================
                // BUTTONS
                // ================================================

                if (
                    interaction.isButton()
                ) {
                    if (
                        interaction.customId
                            .startsWith(
                                "nexona_automod_remove_prev:"
                            )
                    ) {
                        const page =
                            Number(
                                interaction.customId
                                    .split(":")[1]
                            );

                        return showRemovePage(
                            interaction,
                            page
                        );
                    }

                    if (
                        interaction.customId
                            .startsWith(
                                "nexona_automod_remove_next:"
                            )
                    ) {
                        const page =
                            Number(
                                interaction.customId
                                    .split(":")[1]
                            );

                        return showRemovePage(
                            interaction,
                            page
                        );
                    }

                    return;
                }

                // ================================================
                // SLASH COMMAND
                // ================================================

                if (
                    interaction.isChatInputCommand()
                ) {
                    return handleCommand(
                        interaction
                    );
                }

            } catch (error) {
                console.error(
                    "NEXONA AUTOMOD ERROR:",
                    error
                );

                if (
                    !interaction.replied &&
                    !interaction.deferred
                ) {
                    await interaction.reply({
                        content:
                            "Nexona encountered an error while processing this command.",
                        ephemeral:
                            true
                    }).catch(() => {});
                }
            }
        }
    );

    // ========================================================
    // DISCORD AUTOMOD EXECUTION
    // ========================================================

    client.on(
        "autoModerationActionExecution",
        async execution => {
            try {
                if (
                    !execution.guild
                ) {
                    return;
                }

                if (
                    isOwner(
                        execution.userId
                    )
                ) {
                    return;
                }

                const rule =
                    execution.autoModerationRule;

                if (
                    !rule
                ) {
                    return;
                }

                if (
                    !Object.values(
                        RULES
                    ).includes(
                        rule.name
                    )
                ) {
                    return;
                }

                // We only need to react to the
                // BlockMessage action.
                //
                // Discord itself handles:
                // - blocking the message
                // - timeout if configured
                //
                // Nexona handles:
                // - DM
                // - kick
                // - ban

                if (
                    execution.action.type !==
                    AutoModerationActionType.BlockMessage
                ) {
                    return;
                }

                await sendBlockDM(
                    execution
                );

                await executeExternalPunishment(
                    execution
                );

            } catch (error) {
                console.error(
                    "NEXONA AUTOMOD EXECUTION ERROR:",
                    error
                );
            }
        }
    );
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
    commands,

    handleCommand,

    handleMessage,

    install,

    ensureOwnerRole
};