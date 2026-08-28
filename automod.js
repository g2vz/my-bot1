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
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelType,
    AutoModerationRuleTriggerType,
    AutoModerationRuleEventType,
    AutoModerationActionType
} = require("discord.js");

// ============================================================
// NEXONA AUTOMOD
// ============================================================
//
// Discord AutoMod handles blocked words BEFORE the message
// is posted.
//
// Punishment profiles:
//
// DELETE
// TIMEOUT
// KICK
// BAN
//
// Every profile ALWAYS includes Block Message.
//
// Discord AutoMod natively supports:
// - Block Message
// - Timeout
//
// Kick/Ban are handled from the AutoMod execution event,
// after Discord has already blocked the message.
//
// ============================================================


// ============================================================
// CONSTANTS
// ============================================================

const RULE_PREFIX = "NEXONA_AUTOMOD";

const RULE_NAMES = {
    delete: `${RULE_PREFIX}_DELETE`,
    timeout: `${RULE_PREFIX}_TIMEOUT`,
    kick: `${RULE_PREFIX}_KICK`,
    ban: `${RULE_PREFIX}_BAN`
};

const MAX_KEYWORDS_PER_RULE = 1000;
const MAX_KEYWORD_LENGTH = 60;
const MAX_KEYWORD_RULES = 6;
const MAX_TIMEOUT_SECONDS = 2419200;

// ============================================================
// MEMORY
// ============================================================

const guildSettings = new Map();

// Installed interaction listeners.
// This lets automod.js handle modals/select menus without
// requiring a second command file.
//
// ============================================================

const installedClients = new WeakSet();


// ============================================================
// DEFAULT SETTINGS
// ============================================================

function getSettings(guildId) {
    if (!guildSettings.has(guildId)) {
        guildSettings.set(guildId, {

            // --------------------------------------------
            // Default punishment for normal words
            // --------------------------------------------

            wordPunishment: {
                actions: ["delete"],
                duration: null
            },

            // --------------------------------------------
            // Per-word custom punishment
            // --------------------------------------------

            customWords: new Map(),

            // --------------------------------------------
            // Anti-spam
            // --------------------------------------------

            antiSpam: {
                enabled: false,
                messages: 3,
                seconds: 3,

                punishment: {
                    actions: ["delete"],
                    duration: null
                },

                bypassRoleId: null,

                excludedChannelIds: new Set(),

                message: {
                    location: "dm",
                    action: "delete",
                    action2: "none"
                }
            },

            // --------------------------------------------
            // Block announcement DM
            // --------------------------------------------

            blockAnnouncement:
                "hello {user}.\n\n" +
                "your message ({word}) in {servername} have been {action}, " +
                "please re read the rules and contact staff if the message wasn't meant to be deleted"

        });
    }

    return guildSettings.get(guildId);
}


// ============================================================
// PERMISSION CHECK
// ============================================================

function hasManageMessages(interaction) {
    return interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
    );
}


// ============================================================
// TIME PARSER
// ============================================================

function parseDuration(input) {
    if (!input) return null;

    const value =
        String(input)
            .trim()
            .toLowerCase();

    const match =
        value.match(
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
        seconds > MAX_TIMEOUT_SECONDS
    ) {
        return null;
    }

    return seconds;
}


// ============================================================
// FORMAT DURATION
// ============================================================

function formatDuration(seconds) {
    if (!seconds) {
        return "Not applicable";
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
// NORMALIZE ACTIONS
// ============================================================
//
// Examples:
//
// "delete"
// "timeout"
// "delete timeout"
// "timeout delete"
// "kick delete"
// "ban delete"
//
// Delete is always automatically included.
//
// ============================================================

function parsePunishmentActions(input) {
    if (!input) {
        return {
            actions: ["delete"],
            error: null
        };
    }

    const tokens =
        String(input)
            .toLowerCase()
            .replace(/,/g, " ")
            .split(/\s+/)
            .filter(Boolean);

    const allowed = new Set([
        "delete",
        "timeout",
        "kick",
        "ban"
    ]);

    const actions = new Set();

    for (const token of tokens) {
        if (!allowed.has(token)) {
            return {
                actions: null,
                error:
                    `Invalid punishment \`${token}\`. ` +
                    `Use: delete, timeout, kick, or ban.`
            };
        }

        actions.add(token);
    }

    // Delete is ALWAYS included.
    actions.add("delete");

    // Kick and ban cannot both be useful.
    if (
        actions.has("kick") &&
        actions.has("ban")
    ) {
        return {
            actions: null,
            error:
                "You cannot use Kick and Ban together."
        };
    }

    // Timeout cannot be combined with Kick/Ban.
    if (
        actions.has("timeout") &&
        (
            actions.has("kick") ||
            actions.has("ban")
        )
    ) {
        return {
            actions: null,
            error:
                "Timeout cannot be combined with Kick or Ban."
        };
    }

    return {
        actions: [...actions],
        error: null
    };
}


// ============================================================
// PROFILE FROM ACTIONS
// ============================================================

function getProfileFromActions(actions) {
    if (actions.includes("ban")) {
        return "ban";
    }

    if (actions.includes("kick")) {
        return "kick";
    }

    if (actions.includes("timeout")) {
        return "timeout";
    }

    return "delete";
}


// ============================================================
// ACTION LABEL
// ============================================================

function actionLabel(profile) {
    switch (profile) {
        case "delete":
            return "deleted";

        case "timeout":
            return "timed out";

        case "kick":
            return "kicked";

        case "ban":
            return "banned";

        default:
            return profile;
    }
}


// ============================================================
// GET CURRENT WORDS FROM DISCORD AUTOMOD
// ============================================================

async function getNexonaRules(guild) {
    try {
        const rules =
            await guild.autoModerationRules.fetch();

        return rules.filter(rule =>
            Object.values(RULE_NAMES)
                .includes(rule.name)
        );

    } catch (error) {
        console.error(
            "Failed to fetch AutoMod rules:",
            error
        );

        return new Map();
    }
}


// ============================================================
// GET PROFILE RULE
// ============================================================

async function getProfileRule(
    guild,
    profile
) {
    const rules =
        await getNexonaRules(guild);

    const ruleName =
        RULE_NAMES[profile];

    return rules.find(
        rule =>
            rule.name === ruleName
    ) || null;
}


// ============================================================
// GET WORDS FROM ALL NEXONA RULES
// ============================================================

async function getAllBlockedWords(guild) {
    const rules =
        await getNexonaRules(guild);

    const result = [];

    for (const rule of rules) {
        const profile =
            getProfileFromRuleName(
                rule.name
            );

        const keywords =
            rule.triggerMetadata
                ?.keywordFilter || [];

        for (const keyword of keywords) {
            result.push({
                word: keyword,
                profile
            });
        }
    }

    return result;
}


// ============================================================
// PROFILE FROM RULE NAME
// ============================================================

function getProfileFromRuleName(name) {
    for (
        const [profile, ruleName]
        of Object.entries(RULE_NAMES)
    ) {
        if (name === ruleName) {
            return profile;
        }
    }

    return "delete";
}


// ============================================================
// BUILD AUTOMOD ACTIONS
// ============================================================

function buildRuleActions(
    profile,
    duration
) {
    const actions = [];

    // --------------------------------------------
    // ALWAYS BLOCK THE MESSAGE
    // --------------------------------------------

    actions.push({
        type:
            AutoModerationActionType.BlockMessage
    });

    // --------------------------------------------
    // TIMEOUT
    // --------------------------------------------

    if (profile === "timeout") {
        actions.push({
            type:
                AutoModerationActionType.Timeout,

            metadata: {
                durationSeconds:
                    duration
            }
        });
    }

    // Kick/Ban are handled by the bot when the
    // AutoMod execution event fires.

    return actions;
}


// ============================================================
// CREATE / UPDATE PROFILE RULE
// ============================================================

async function syncProfileRule(
    guild,
    profile,
    keywords,
    duration
) {
    if (
        ![
            "delete",
            "timeout",
            "kick",
            "ban"
        ].includes(profile)
    ) {
        return;
    }

    const cleanKeywords =
        [...new Set(
            keywords
                .map(word =>
                    String(word)
                        .trim()
                        .toLowerCase()
                )
                .filter(Boolean)
        )];

    const existing =
        await getProfileRule(
            guild,
            profile
        );

    // --------------------------------------------
    // Empty profile
    // --------------------------------------------

    if (cleanKeywords.length === 0) {
        if (existing) {
            await existing.delete(
                "Nexona AutoMod profile became empty"
            );
        }

        return;
    }

    // --------------------------------------------
    // Discord max is 1000 keywords per rule.
    // This system intentionally keeps one rule per
    // punishment profile, so if a profile exceeds
    // 1000 words, we stop with a clear error.
    // --------------------------------------------

    if (
        cleanKeywords.length >
        MAX_KEYWORDS_PER_RULE
    ) {
        throw new Error(
            `The ${profile} AutoMod profile has more than ` +
            `${MAX_KEYWORDS_PER_RULE} words.`
        );
    }

    const exemptChannels = [];

    // --------------------------------------------
    // CREATE
    // --------------------------------------------

    if (!existing) {
        await guild.autoModerationRules.create({
            name:
                RULE_NAMES[profile],

            eventType:
                AutoModerationRuleEventType.MessageSend,

            triggerType:
                AutoModerationRuleTriggerType.Keyword,

            triggerMetadata: {
                keywordFilter:
                    cleanKeywords
            },

            actions:
                buildRuleActions(
                    profile,
                    duration
                ),

            enabled: true,

            exemptChannels,

            reason:
                "Nexona AutoMod"
        });

        return;
    }

    // --------------------------------------------
    // UPDATE
    // --------------------------------------------

    await existing.edit({
        enabled: true,

        triggerMetadata: {
            keywordFilter:
                cleanKeywords
        },

        actions:
            buildRuleActions(
                profile,
                duration
            ),

        exemptChannels,

        reason:
            "Nexona AutoMod update"
    });
}


// ============================================================
// REBUILD ALL NEXONA KEYWORD RULES
// ============================================================
//
// Words are stored by profile in Discord itself.
// This means the word list survives bot restarts.
//
// In-memory customWords is restored when commands are used,
// but the actual blocked words live in Discord AutoMod.
//
// ============================================================

async function rebuildKeywordRules(
    guild
) {
    const settings =
        getSettings(guild.id);

    const allWords =
        await getAllBlockedWords(
            guild
        );

    const profileWords = {
        delete: [],
        timeout: [],
        kick: [],
        ban: []
    };

    // Existing words stay in their current profiles.
    for (const entry of allWords) {
        if (
            profileWords[entry.profile]
        ) {
            profileWords[
                entry.profile
            ].push(entry.word);
        }
    }

    // Sync custom/default data.
    //
    // This function is intentionally not destructive
    // to existing custom profiles.
    //
    for (
        const [word, custom]
        of settings.customWords
    ) {
        for (
            const profile
            of Object.keys(profileWords)
        ) {
            profileWords[profile] =
                profileWords[profile]
                    .filter(
                        existingWord =>
                            existingWord !== word
                    );
        }

        const profile =
            getProfileFromActions(
                custom.actions
            );

        profileWords[profile].push(
            word
        );
    }

    // --------------------------------------------
    // Sync
    // --------------------------------------------

    await syncProfileRule(
        guild,
        "delete",
        profileWords.delete,
        null
    );

    await syncProfileRule(
        guild,
        "timeout",
        profileWords.timeout,
        getTimeoutForProfile(
            settings,
            "timeout"
        )
    );

    await syncProfileRule(
        guild,
        "kick",
        profileWords.kick,
        null
    );

    await syncProfileRule(
        guild,
        "ban",
        profileWords.ban,
        null
    );
}


// ============================================================
// GET TIMEOUT FOR PROFILE
// ============================================================

function getTimeoutForProfile(
    settings,
    profile
) {
    if (
        profile === "timeout" &&
        settings.wordPunishment.actions
            .includes("timeout")
    ) {
        return (
            settings.wordPunishment.duration ||
            60
        );
    }

    return 60;
}


// ============================================================
// ADD WORDS TO DEFAULT PROFILE
// ============================================================

async function addWords(
    guild,
    words
) {
    const settings =
        getSettings(guild.id);

    const cleanWords =
        [...new Set(
            words
                .map(word =>
                    String(word)
                        .trim()
                        .toLowerCase()
                )
                .filter(Boolean)
        )];

    if (
        cleanWords.length === 0
    ) {
        return {
            added: [],
            skipped: [],
            error: "No valid words were provided."
        };
    }

    const invalid =
        cleanWords.filter(
            word =>
                word.length >
                MAX_KEYWORD_LENGTH
        );

    if (invalid.length) {
        return {
            added: [],
            skipped: [],
            error:
                `These words are longer than ${MAX_KEYWORD_LENGTH} characters:\n` +
                invalid
                    .slice(0, 10)
                    .map(word =>
                        `\`${word}\``
                    )
                    .join(", ")
        };
    }

    // --------------------------------------------
    // Current words
    // --------------------------------------------

    const existing =
        await getAllBlockedWords(
            guild
        );

    const existingSet =
        new Set(
            existing.map(
                entry =>
                    entry.word
            )
        );

    const newWords =
        cleanWords.filter(
            word =>
                !existingSet.has(word)
        );

    const skipped =
        cleanWords.filter(
            word =>
                existingSet.has(word)
        );

    if (
        newWords.length === 0
    ) {
        return {
            added: [],
            skipped,
            error: null
        };
    }

    // --------------------------------------------
    // Default punishment
    // --------------------------------------------

    const profile =
        getProfileFromActions(
            settings.wordPunishment.actions
        );

    const currentProfileWords =
        existing
            .filter(
                entry =>
                    entry.profile === profile
            )
            .map(
                entry =>
                    entry.word
            );

    if (
        currentProfileWords.length +
        newWords.length >
        MAX_KEYWORDS_PER_RULE
    ) {
        return {
            added: [],
            skipped,
            error:
                `The ${profile} AutoMod rule can contain a maximum of ${MAX_KEYWORDS_PER_RULE} words.`
        };
    }

    const duration =
        profile === "timeout"
            ? (
                settings.wordPunishment.duration ||
                60
            )
            : null;

    await syncProfileRule(
        guild,
        profile,
        [
            ...currentProfileWords,
            ...newWords
        ],
        duration
    );

    return {
        added: newWords,
        skipped,
        error: null
    };
}


// ============================================================
// REMOVE WORD
// ============================================================

async function removeWord(
    guild,
    word
) {
    const cleanWord =
        String(word)
            .trim()
            .toLowerCase();

    const rules =
        await getNexonaRules(
            guild
        );

    for (const rule of rules) {
        const keywords =
            [
                ...(
                    rule.triggerMetadata
                        ?.keywordFilter || []
                )
            ];

        if (
            keywords.includes(
                cleanWord
            )
        ) {
            const updated =
                keywords.filter(
                    item =>
                        item !== cleanWord
                );

            const profile =
                getProfileFromRuleName(
                    rule.name
                );

            const settings =
                getSettings(
                    guild.id
                );

            await syncProfileRule(
                guild,
                profile,
                updated,
                profile === "timeout"
                    ? (
                        settings.wordPunishment.duration ||
                        60
                    )
                    : null
            );

            settings.customWords.delete(
                cleanWord
            );

            return true;
        }
    }

    return false;
}


// ============================================================
// MOVE WORD TO CUSTOM PROFILE
// ============================================================

async function setCustomWord(
    guild,
    word,
    actions,
    duration
) {
    const cleanWord =
        String(word)
            .trim()
            .toLowerCase();

    const allWords =
        await getAllBlockedWords(
            guild
        );

    const found =
        allWords.find(
            entry =>
                entry.word ===
                cleanWord
        );

    if (!found) {
        return {
            success: false,
            error:
                `\`${cleanWord}\` does not exist in AutoMod. Add it first using \`/automod-add\`.`
        };
    }

    const settings =
        getSettings(
            guild.id
        );

    settings.customWords.set(
        cleanWord,
        {
            actions,
            duration
        }
    );

    // --------------------------------------------
    // Remove it from current profile
    // --------------------------------------------

    const oldRule =
        await getProfileRule(
            guild,
            found.profile
        );

    if (oldRule) {
        const keywords =
            [
                ...(
                    oldRule.triggerMetadata
                        ?.keywordFilter || []
                )
            ].filter(
                item =>
                    item !== cleanWord
            );

        await syncProfileRule(
            guild,
            found.profile,
            keywords,
            found.profile === "timeout"
                ? (
                    settings.wordPunishment.duration ||
                    60
                )
                : null
        );
    }

    // --------------------------------------------
    // Add to new profile
    // --------------------------------------------

    const newProfile =
        getProfileFromActions(
            actions
        );

    const newRule =
        await getProfileRule(
            guild,
            newProfile
        );

    const current =
        newRule
            ? [
                ...(
                    newRule.triggerMetadata
                        ?.keywordFilter || []
                )
            ]
            : [];

    if (
        !current.includes(
            cleanWord
        )
    ) {
        current.push(
            cleanWord
        );
    }

    await syncProfileRule(
        guild,
        newProfile,
        current,
        newProfile === "timeout"
            ? (
                duration ||
                60
            )
            : null
    );

    return {
        success: true,
        error: null
    };
}


// ============================================================
// BLOCK ANNOUNCEMENT
// ============================================================

function replaceVariables(
    text,
    {
        user,
        word,
        guild,
        action
    }
) {
    return String(text)
        .replace(
            /\{user\}/gi,
            `<@${user.id}>`
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
    try {
        const member =
            execution.member ||
            await execution.guild.members
                .fetch(
                    execution.userId
                )
                .catch(() => null);

        if (!member) {
            return;
        }

        const settings =
            getSettings(
                execution.guild.id
            );

        const word =
            execution.matchedKeyword ||
            execution.matchedContent ||
            "blocked word";

        const profile =
            getProfileFromRuleName(
                execution.autoModerationRule
                    ?.name ||
                ""
            );

        const action =
            actionLabel(
                profile
            );

        const description =
            replaceVariables(
                settings.blockAnnouncement,
                {
                    user: member.user,
                    word,
                    guild:
                        execution.guild,
                    action
                }
            );

        const embed =
            new EmbedBuilder()
                .setTitle(
                    "Nexona AutoMod"
                )
                .setDescription(
                    description
                )
                .setFooter({
                    text:
                        `${execution.guild.name} auto mod`
                })
                .setTimestamp();

        await member.send({
            embeds: [embed]
        });

    } catch (error) {
        // DMs can be disabled.
    }
}


// ============================================================
// APPLY KICK/BAN
// ============================================================

async function applyExternalPunishment(
    execution,
    profile
) {
    const member =
        execution.member ||
        await execution.guild.members
            .fetch(
                execution.userId
            )
            .catch(() => null);

    if (!member) {
        return;
    }

    try {
        if (
            profile === "kick"
        ) {
            if (
                member.kickable
            ) {
                await member.kick(
                    "Nexona AutoMod: blocked keyword"
                );
            }

            return;
        }

        if (
            profile === "ban"
        ) {
            if (
                member.bannable
            ) {
                await member.ban({
                    reason:
                        "Nexona AutoMod: blocked keyword",
                    deleteMessageSeconds: 0
                });
            }
        }

    } catch (error) {
        console.error(
            "Nexona external AutoMod punishment error:",
            error
        );
    }
}


// ============================================================
// INTERACTION INSTALLER
// ============================================================

function installInteractionHandlers(
    client
) {
    if (
        installedClients.has(client)
    ) {
        return;
    }

    installedClients.add(client);

    client.on(
        "interactionCreate",
        async interaction => {

            try {

                // ==================================================
                // MODAL
                // ==================================================

                if (
                    interaction.isModalSubmit()
                ) {

                    if (
                        interaction.customId
                            .startsWith(
                                "nexona_automod_add:"
                            )
                    ) {
                        if (
                            !interaction.guild
                        ) {
                            return;
                        }

                        if (
                            !hasManageMessages(
                                interaction
                            )
                        ) {
                            return interaction.reply({
                                content:
                                    "You need the Manage Messages permission.",
                                ephemeral: true
                            });
                        }

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
                                        word.trim()
                                )
                                .filter(Boolean);

                        const result =
                            await addWords(
                                interaction.guild,
                                words
                            );

                        if (
                            result.error
                        ) {
                            return interaction.reply({
                                content:
                                    result.error,
                                ephemeral: true
                            });
                        }

                        const embed =
                            new EmbedBuilder()
                                .setTitle(
                                    "Nexona AutoMod"
                                )
                                .setDescription(
                                    `Added **${result.added.length}** word(s) to Discord AutoMod.\n\n` +
                                    `Skipped **${result.skipped.length}** existing word(s).`
                                )
                                .setTimestamp();

                        return interaction.reply({
                            embeds: [embed],
                            ephemeral: true
                        });
                    }
                }

                // ==================================================
                // SELECT MENUS
                // ==================================================

                if (
                    interaction.isStringSelectMenu()
                ) {

                    // ----------------------------------------------
                    // REMOVE WORD
                    // ----------------------------------------------

                    if (
                        interaction.customId
                            .startsWith(
                                "nexona_automod_remove:"
                            )
                    ) {
                        if (
                            !hasManageMessages(
                                interaction
                            )
                        ) {
                            return interaction.reply({
                                content:
                                    "You need the Manage Messages permission.",
                                ephemeral: true
                            });
                        }

                        const word =
                            interaction.values[0];

                        const removed =
                            await removeWord(
                                interaction.guild,
                                word
                            );

                        return interaction.update({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle(
                                        "Nexona AutoMod"
                                    )
                                    .setDescription(
                                        removed
                                            ? `Removed \`${word}\` from the blocked-word list.`
                                            : `\`${word}\` was not found.`
                                    )
                                    .setTimestamp()
                            ],
                            components: []
                        });
                    }
                }

                // ==================================================
                // BUTTONS
                // ==================================================

                if (
                    interaction.isButton()
                ) {

                    if (
                        interaction.customId
                            .startsWith(
                                "nexona_automod_remove_next:"
                            )
                    ) {
                        if (
                            !hasManageMessages(
                                interaction
                            )
                        ) {
                            return;
                        }

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
                                "nexona_automod_remove_prev:"
                            )
                    ) {
                        if (
                            !hasManageMessages(
                                interaction
                            )
                        ) {
                            return;
                        }

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
                }

            } catch (error) {
                console.error(
                    "Nexona AutoMod component error:",
                    error
                );

                if (
                    !interaction.replied &&
                    !interaction.deferred
                ) {
                    await interaction.reply({
                        content:
                            "Something went wrong while processing this AutoMod action.",
                        ephemeral: true
                    }).catch(() => {});
                }
            }
        }
    );

    // ========================================================
    // AUTOMOD EXECUTION
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

                // Only Nexona rules.
                const rule =
                    execution.autoModerationRule;

                if (
                    !rule ||
                    !Object.values(
                        RULE_NAMES
                    ).includes(
                        rule.name
                    )
                ) {
                    return;
                }

                // We only use the BLOCK_MESSAGE
                // execution as our single trigger.
                //
                // Timeout rules also fire a Timeout
                // execution, so this prevents duplicate DMs.

                if (
                    execution.action.type !==
                    AutoModerationActionType.BlockMessage
                ) {
                    return;
                }

                const profile =
                    getProfileFromRuleName(
                        rule.name
                    );

                // --------------------------------------------
                // Kick / Ban
                // --------------------------------------------

                if (
                    profile === "kick" ||
                    profile === "ban"
                ) {
                    await applyExternalPunishment(
                        execution,
                        profile
                    );
                }

                // --------------------------------------------
                // DM
                // --------------------------------------------

                await sendBlockDM(
                    execution
                );

            } catch (error) {
                console.error(
                    "Nexona AutoMod execution error:",
                    error
                );
            }
        }
    );
}


// ============================================================
// SHOW AUTOMOD REMOVE PAGE
// ============================================================

async function showRemovePage(
    interaction,
    page = 0
) {
    const words =
        await getAllBlockedWords(
            interaction.guild
        );

    if (
        words.length === 0
    ) {
        return interaction.reply({
            content:
                "There are currently no blocked words.",
            ephemeral: true
        });
    }

    const pageSize = 25;

    const totalPages =
        Math.ceil(
            words.length /
            pageSize
        );

    const safePage =
        Math.max(
            0,
            Math.min(
                page,
                totalPages - 1
            )
        );

    const pageWords =
        words.slice(
            safePage * pageSize,
            (safePage + 1) *
                pageSize
        );

    const select =
        new StringSelectMenuBuilder()
            .setCustomId(
                `nexona_automod_remove:${safePage}`
            )
            .setPlaceholder(
                "Select a blocked word to remove"
            )
            .addOptions(
                pageWords.map(
                    entry =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(
                                entry.word
                                    .slice(0, 100)
                            )
                            .setDescription(
                                `Action: ${entry.profile}`
                            )
                            .setValue(
                                entry.word
                            )
                )
            );

    const row =
        new ActionRowBuilder()
            .addComponents(
                select
            );

    const buttons = [];

    if (
        safePage > 0
    ) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(
                    `nexona_automod_remove_prev:${safePage - 1}`
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
        safePage <
        totalPages - 1
    ) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(
                    `nexona_automod_remove_next:${safePage + 1}`
                )
                .setLabel(
                    "Next"
                )
                .setStyle(
                    ButtonStyle.Secondary
                )
        );
    }

    const components =
        [row];

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
                `Select the word you want to remove.\n\n` +
                `Page **${safePage + 1}/${totalPages}**`
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
// COMMANDS
// ============================================================

const commands = [

    // ========================================================
    // /automod-add
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "automod-add"
        )
        .setDescription(
            "Open the Nexona AutoMod word manager."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        ),

    // ========================================================
    // /automod-remove
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
    // /automod-list
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "automod-list"
        )
        .setDescription(
            "Show Nexona's blocked-word list."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        ),

    // ========================================================
    // /punishment
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "punishment"
        )
        .setDescription(
            "Configure AutoMod punishment actions."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName(
                    "action"
                )
                .setDescription(
                    "What should this punishment apply to?"
                )
                .setRequired(true)
                .addChoices(
                    {
                        name: "Spam",
                        value: "spam"
                    },
                    {
                        name: "Blocked Words",
                        value: "words"
                    }
                )
        )

        .addStringOption(option =>
            option
                .setName(
                    "punishment"
                )
                .setDescription(
                    "Use: delete, timeout, kick, ban. Example: delete timeout"
                )
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName(
                    "for"
                )
                .setDescription(
                    "Timeout duration, e.g. 5m, 1h, 1d"
                )
                .setRequired(false)
        ),

    // ========================================================
    // /custom-words
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "custom-words"
        )
        .setDescription(
            "Give one blocked word a custom punishment."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName(
                    "word"
                )
                .setDescription(
                    "Blocked word to customize."
                )
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName(
                    "punishment"
                )
                .setDescription(
                    "Use: delete, timeout, kick, ban. Example: delete timeout"
                )
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName(
                    "for"
                )
                .setDescription(
                    "Timeout duration, e.g. 5m, 1h, 1d"
                )
                .setRequired(false)
        ),

    // ========================================================
    // /block-annc
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "block-annc"
        )
        .setDescription(
            "Change the AutoMod blocked-message DM."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
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
    // /anti-spam
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "anti-spam"
        )
        .setDescription(
            "Configure Nexona's custom anti-spam."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName(
                    "status"
                )
                .setDescription(
                    "Enable or disable anti-spam."
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
                .setName(
                    "messages"
                )
                .setDescription(
                    "Number of messages."
                )
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(5)
        )

        .addIntegerOption(option =>
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
    // /spam-message
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "spam-message"
        )
        .setDescription(
            "Configure the Nexona anti-spam message."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addStringOption(option =>
            option
                .setName(
                    "location"
                )
                .setDescription(
                    "Where should the spam message be sent?"
                )
                .setRequired(true)
                .addChoices(
                    {
                        name: "DM",
                        value: "dm"
                    },
                    {
                        name: "Spam Channel",
                        value: "channel"
                    }
                )
        )

        .addStringOption(option =>
            option
                .setName(
                    "action"
                )
                .setDescription(
                    "First action."
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
                    },
                    {
                        name: "None",
                        value: "none"
                    }
                )
        )

        .addStringOption(option =>
            option
                .setName(
                    "action2"
                )
                .setDescription(
                    "Optional second action."
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
                    },
                    {
                        name: "Kick",
                        value: "kick"
                    },
                    {
                        name: "Ban",
                        value: "ban"
                    },
                    {
                        name: "None",
                        value: "none"
                    }
                )
        ),

    // ========================================================
    // /spam-channel
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "spam-channel"
        )
        .setDescription(
            "Exclude a channel from Nexona anti-spam."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addChannelOption(option =>
            option
                .setName(
                    "channel"
                )
                .setDescription(
                    "Channel where anti-spam should be disabled."
                )
                .setRequired(true)
                .addChannelTypes(
                    ChannelType.GuildText,
                    ChannelType.GuildAnnouncement,
                    ChannelType.GuildForum,
                    ChannelType.PublicThread,
                    ChannelType.PrivateThread
                )
        )

        .addStringOption(option =>
            option
                .setName(
                    "status"
                )
                .setDescription(
                    "Enable or disable the exclusion."
                )
                .setRequired(false)
                .addChoices(
                    {
                        name: "Exclude",
                        value: "exclude"
                    },
                    {
                        name: "Remove Exclusion",
                        value: "remove"
                    }
                )
        ),

    // ========================================================
    // /bypass-antispam
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "bypass-antispam"
        )
        .setDescription(
            "Choose a role that bypasses Nexona anti-spam."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )

        .addRoleOption(option =>
            option
                .setName(
                    "role"
                )
                .setDescription(
                    "Members with this role bypass anti-spam."
                )
                .setRequired(true)
        )
];


// ============================================================
// COMMAND HANDLER
// ============================================================

async function handleCommand(
    interaction
) {
    if (
        !interaction.inGuild()
    ) {
        return interaction.reply({
            content:
                "This command can only be used inside a server.",
            ephemeral: true
        });
    }

    if (
        !hasManageMessages(
            interaction
        )
    ) {
        return interaction.reply({
            content:
                "You need the Manage Messages permission to use Nexona AutoMod.",
            ephemeral: true
        });
    }

    // Install modal/select/event listeners.
    installInteractionHandlers(
        interaction.client
    );

    const guild =
        interaction.guild;

    const settings =
        getSettings(
            guild.id
        );


    // ========================================================
    // /automod-add
    // ========================================================

    if (
        interaction.commandName ===
        "automod-add"
    ) {

        const modal =
            new ModalBuilder()
                .setCustomId(
                    `nexona_automod_add:${guild.id}`
                )
                .setTitle(
                    "Nexona AutoMod"
                );

        const wordsInput =
            new TextInputBuilder()
                .setCustomId(
                    "words"
                )
                .setLabel(
                    "Blocked words"
                )
                .setPlaceholder(
                    "word1\nword2\nword3"
                )
                .setStyle(
                    TextInputStyle.Paragraph
                )
                .setRequired(true)
                .setMaxLength(
                    4000
                );

        const row =
            new ActionRowBuilder()
                .addComponents(
                    wordsInput
                );

        modal.addComponents(
            row
        );

        return interaction.showModal(
            modal
        );
    }


    // ========================================================
    // /automod-remove
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
    // /automod-list
    // ========================================================

    if (
        interaction.commandName ===
        "automod-list"
    ) {

        const words =
            await getAllBlockedWords(
                guild
            );

        if (
            words.length === 0
        ) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            `list of ${guild.name}'s blocked messages`
                        )
                        .setDescription(
                            "There are currently no blocked words."
                        )
                        .setFooter({
                            text:
                                guild.name
                        })
                ],
                ephemeral: true
            });
        }

        const groups = {
            delete: [],
            timeout: [],
            kick: [],
            ban: []
        };

        for (
            const entry
            of words
        ) {
            if (
                groups[
                    entry.profile
                ]
            ) {
                groups[
                    entry.profile
                ].push(
                    entry.word
                );
            }
        }

        let description = "";

        for (
            const profile
            of [
                "delete",
                "timeout",
                "kick",
                "ban"
            ]
        ) {

            if (
                groups[profile].length ===
                0
            ) {
                continue;
            }

            description +=
                `**action: ${profile}**\n`;

            description +=
                groups[profile]
                    .map(
                        word =>
                            `\`${word}\``
                    )
                    .join("\n");

            description +=
                "\n\n";
        }

        description +=
            `\n**${guild.name}**`;

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        `list of ${guild.name}'s blocked messages`
                    )
                    .setDescription(
                        description
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }


    // ========================================================
    // /punishment
    // ========================================================

    if (
        interaction.commandName ===
        "punishment"
    ) {

        const target =
            interaction.options.getString(
                "action"
            );

        const punishmentInput =
            interaction.options.getString(
                "punishment"
            );

        const durationInput =
            interaction.options.getString(
                "for"
            );

        const parsed =
            parsePunishmentActions(
                punishmentInput
            );

        if (
            parsed.error
        ) {
            return interaction.reply({
                content:
                    parsed.error,
                ephemeral: true
            });
        }

        const actions =
            parsed.actions;

        const hasTimeout =
            actions.includes(
                "timeout"
            );

        let duration =
            null;

        if (hasTimeout) {

            if (!durationInput) {
                return interaction.reply({
                    content:
                        "You must provide `for` when using Timeout. Example: `5m`.",
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
                        "Invalid duration. Use `30s`, `1m`, `5m`, `1h`, or `1d`. Maximum is 28 days.",
                    ephemeral: true
                });
            }
        }

        // --------------------------------------------
        // SPAM
        // --------------------------------------------

        if (
            target === "spam"
        ) {
            settings.antiSpam.punishment = {
                actions,
                duration
            };

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            "Nexona Spam Punishment"
                        )
                        .setDescription(
                            `**Actions:** ${actions.join(" + ")}\n` +
                            `**Duration:** ${
                                duration
                                    ? formatDuration(
                                        duration
                                    )
                                    : "Not applicable"
                            }`
                        )
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }

        // --------------------------------------------
        // WORDS
        // --------------------------------------------

        if (
            target === "words"
        ) {

            settings.wordPunishment = {
                actions,
                duration
            };

            // Rebuild all non-custom words
            // using the new default.
            const allWords =
                await getAllBlockedWords(
                    guild
                );

            const customSet =
                new Set(
                    settings.customWords.keys()
                );

            const defaultWords =
                allWords
                    .filter(
                        entry =>
                            !customSet.has(
                                entry.word
                            )
                    )
                    .map(
                        entry =>
                            entry.word
                    );

            // Delete current Nexona keyword rules
            const rules =
                await getNexonaRules(
                    guild
                );

            for (
                const rule
                of rules
            ) {
                await rule.delete(
                    "Nexona AutoMod punishment profile rebuild"
                );
            }

            const profile =
                getProfileFromActions(
                    actions
                );

            await syncProfileRule(
                guild,
                profile,
                defaultWords,
                duration
            );

            // Restore custom words.
            for (
                const [
                    word,
                    custom
                ]
                of settings.customWords
            ) {
                await setCustomWord(
                    guild,
                    word,
                    custom.actions,
                    custom.duration
                );
            }

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            "Nexona Word Punishment"
                        )
                        .setDescription(
                            `**Actions:** ${actions.join(" + ")}\n` +
                            `**Duration:** ${
                                duration
                                    ? formatDuration(
                                        duration
                                    )
                                    : "Not applicable"
                            }`
                        )
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }
    }


    // ========================================================
    // /custom-words
    // ========================================================

    if (
        interaction.commandName ===
        "custom-words"
    ) {

        const word =
            interaction.options.getString(
                "word"
            )
                .trim()
                .toLowerCase();

        const punishmentInput =
            interaction.options.getString(
                "punishment"
            );

        const durationInput =
            interaction.options.getString(
                "for"
            );

        const parsed =
            parsePunishmentActions(
                punishmentInput
            );

        if (
            parsed.error
        ) {
            return interaction.reply({
                content:
                    parsed.error,
                ephemeral: true
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

            if (!durationInput) {
                return interaction.reply({
                    content:
                        "You must provide `for` when using Timeout.",
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
                        "Invalid duration. Example: `5m`, `1h`, `1d`.",
                    ephemeral: true
                });
            }
        }

        const result =
            await setCustomWord(
                guild,
                word,
                actions,
                duration
            );

        if (
            !result.success
        ) {
            return interaction.reply({
                content:
                    result.error,
                ephemeral: true
            });
        }

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Custom Word"
                    )
                    .setDescription(
                        `\`${word}\` now uses:\n\n` +
                        `**${actions.join(" + ")}**\n` +
                        `**Duration:** ${
                            duration
                                ? formatDuration(
                                    duration
                                )
                                : "Not applicable"
                        }`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }


    // ========================================================
    // /block-annc
    // ========================================================

    if (
        interaction.commandName ===
        "block-annc"
    ) {

        const message =
            interaction.options.getString(
                "message"
            );

        settings.blockAnnouncement =
            message;

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
            ephemeral: true
        });
    }


    // ========================================================
    // /anti-spam
    // ========================================================

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

        if (
            status !== null
        ) {
            settings.antiSpam.enabled =
                status === "on";
        }

        if (
            messages !== null
        ) {
            settings.antiSpam.messages =
                messages;
        }

        if (
            seconds !== null
        ) {
            settings.antiSpam.seconds =
                seconds;
        }

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Anti-Spam"
                    )
                    .setDescription(
                        `**Status:** ${
                            settings.antiSpam.enabled
                                ? "ON"
                                : "OFF"
                        }\n` +
                        `**Messages:** ${settings.antiSpam.messages}\n` +
                        `**Seconds:** ${settings.antiSpam.seconds}\n\n` +
                        `**Note:** Nexona's custom message-count threshold is handled by Nexona. Discord AutoMod's native Spam Content filter uses its own spam detection and does not expose this exact X-messages-in-Y-seconds threshold.`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }


    // ========================================================
    // /spam-message
    // ========================================================

    if (
        interaction.commandName ===
        "spam-message"
    ) {

        const location =
            interaction.options.getString(
                "location"
            );

        const action =
            interaction.options.getString(
                "action"
            );

        const action2 =
            interaction.options.getString(
                "action2"
            ) || "none";

        settings.antiSpam.message = {
            location,
            action,
            action2
        };

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Spam Message"
                    )
                    .setDescription(
                        `**Location:** ${location}\n` +
                        `**Action:** ${action}\n` +
                        `**Action 2:** ${action2}`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }


    // ========================================================
    // /spam-channel
    // ========================================================

    if (
        interaction.commandName ===
        "spam-channel"
    ) {

        const channel =
            interaction.options.getChannel(
                "channel"
            );

        const status =
            interaction.options.getString(
                "status"
            ) || "exclude";

        if (
            status === "exclude"
        ) {
            settings.antiSpam
                .excludedChannelIds
                .add(
                    channel.id
                );
        } else {
            settings.antiSpam
                .excludedChannelIds
                .delete(
                    channel.id
                );
        }

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Spam Channel"
                    )
                    .setDescription(
                        status === "exclude"
                            ? `${channel} is now excluded from anti-spam.`
                            : `${channel} is no longer excluded from anti-spam.`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }


    // ========================================================
    // /bypass-antispam
    // ========================================================

    if (
        interaction.commandName ===
        "bypass-antispam"
    ) {

        const role =
            interaction.options.getRole(
                "role"
            );

        settings.antiSpam
            .bypassRoleId =
            role.id;

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "Nexona Anti-Spam Bypass"
                    )
                    .setDescription(
                        `Members with ${role} will now bypass Nexona anti-spam.`
                    )
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }
}


// ============================================================
// CUSTOM MESSAGE HANDLER
// ============================================================
//
// IMPORTANT:
// Discord AutoMod handles keyword blocking itself.
// This message handler is ONLY for Nexona's custom
// X-messages-in-Y-seconds anti-spam.
//
// ============================================================

const spamTrackers =
    new Map();

function getTracker(
    guildId,
    userId
) {
    const key =
        `${guildId}:${userId}`;

    if (
        !spamTrackers.has(key)
    ) {
        spamTrackers.set(
            key,
            []
        );
    }

    return spamTrackers.get(
        key
    );
}


async function handleMessage(
    message
) {
    if (
        !message.guild ||
        message.author.bot
    ) {
        return;
    }

    const settings =
        getSettings(
            message.guild.id
        );

    const antiSpam =
        settings.antiSpam;

    if (
        !antiSpam.enabled
    ) {
        return;
    }

    // --------------------------------------------
    // Excluded channel
    // --------------------------------------------

    if (
        antiSpam
            .excludedChannelIds
            .has(
                message.channel.id
            )
    ) {
        return;
    }

    // --------------------------------------------
    // Bypass role
    // --------------------------------------------

    if (
        antiSpam.bypassRoleId &&
        message.member?.roles.cache.has(
            antiSpam.bypassRoleId
        )
    ) {
        return;
    }

    // --------------------------------------------
    // Track messages
    // --------------------------------------------

    const tracker =
        getTracker(
            message.guild.id,
            message.author.id
        );

    const now =
        Date.now();

    tracker.push(
        now
    );

    const windowMs =
        antiSpam.seconds *
        1000;

    while (
        tracker.length &&
        now - tracker[0] >=
            windowMs
    ) {
        tracker.shift();
    }

    if (
        tracker.length <
        antiSpam.messages
    ) {
        return;
    }

    // --------------------------------------------
    // Clear tracker
    // --------------------------------------------

    tracker.length = 0;

    // --------------------------------------------
    // IMPORTANT:
    // Delete the message immediately.
    //
    // This custom anti-spam system cannot prevent
    // the message from appearing because Discord
    // has already delivered MESSAGE_CREATE.
    // Keyword AutoMod does prevent posting.
    // --------------------------------------------

    await message.delete()
        .catch(() => {});

    const punishment =
        antiSpam.punishment;

    const actions =
        punishment.actions;

    // --------------------------------------------
    // Timeout
    // --------------------------------------------

    if (
        actions.includes(
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

    // --------------------------------------------
    // Kick
    // --------------------------------------------

    if (
        actions.includes(
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

    // --------------------------------------------
    // Ban
    // --------------------------------------------

    if (
        actions.includes(
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

    // --------------------------------------------
    // Spam announcement
    // --------------------------------------------

    await sendSpamAnnouncement(
        message,
        settings
    );
}


// ============================================================
// SPAM ANNOUNCEMENT
// ============================================================

async function sendSpamAnnouncement(
    message,
    settings
) {
    const config =
        settings.antiSpam.message;

    const embed =
        new EmbedBuilder()
            .setTitle(
                "Nexona Anti-Spam"
            )
            .setDescription(
                "Your message was blocked because you were sending messages too quickly."
            )
            .setFooter({
                text:
                    `${message.guild.name} auto mod`
            })
            .setTimestamp();

    try {

        if (
            config.location ===
            "dm"
        ) {
            await message.author.send({
                embeds: [embed]
            });

        } else {

            await message.channel.send({
                content:
                    `<@${message.author.id}>`,
                embeds: [embed]
            });

        }

    } catch {
        // Ignore blocked DMs / unavailable channel.
    }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    commands,
    handleCommand,
    handleMessage,
    getSettings,
    installInteractionHandlers
};