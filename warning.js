const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ============================================================
// NEXONA WARNING SYSTEM
// ============================================================

const DATA_FILE = path.join(
    __dirname,
    "warnings.json"
);

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
            "Failed to load warnings.json:",
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


// ============================================================
// GUILD DATA
// ============================================================

function getGuildData(guildId) {

    if (!database[guildId]) {

        database[guildId] = {

            nextWarningId: 1,

            users: {},

            permissions: {
                warn: []
            }

        };

        saveData(database);
    }

    const data = database[guildId];


    // --------------------------------------------------------
    // Database migration / safety
    // --------------------------------------------------------

    if (
        typeof data.nextWarningId !== "number"
    ) {
        data.nextWarningId = 1;
    }

    if (
        !data.users ||
        typeof data.users !== "object"
    ) {
        data.users = {};
    }

    if (
        !data.permissions ||
        typeof data.permissions !== "object"
    ) {
        data.permissions = {};
    }

    if (
        !Array.isArray(
            data.permissions.warn
        )
    ) {
        data.permissions.warn = [];
    }

    return data;
}


// ============================================================
// MODERATOR
// ============================================================

function isModerator(interaction) {

    return interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
    );
}


// ============================================================
// CUSTOM PERMISSIONS
// ============================================================
//
// Nexona permissions are NOT Discord permissions.
//
// Example:
//
// /permissions @Moderators warn
//
// The role will then be able to use:
// /warn
// /unwarn
//
// ============================================================

function hasNexonaPermission(
    interaction,
    permission
) {

    if (
        !interaction.guild ||
        !interaction.member
    ) {
        return false;
    }


    // Server moderators always have custom permissions.
    if (
        isModerator(
            interaction
        )
    ) {
        return true;
    }


    const data =
        getGuildData(
            interaction.guild.id
        );


    const allowedRoles =
        data.permissions?.[permission] || [];


    if (
        allowedRoles.length === 0
    ) {
        return false;
    }


    return interaction.member.roles.cache.some(
        role =>
            allowedRoles.includes(
                role.id
            )
    );
}


// ============================================================
// USER DATA
// ============================================================

function getUserWarnings(
    guildId,
    userId
) {

    const data =
        getGuildData(
            guildId
        );


    if (
        !data.users[userId]
    ) {

        data.users[userId] = {
            warnings: []
        };

        saveData(
            database
        );
    }


    if (
        !Array.isArray(
            data.users[userId].warnings
        )
    ) {

        data.users[userId].warnings = [];
    }


    return data.users[userId].warnings;
}


// ============================================================
// ADD WARNING
// ============================================================

function addWarning(
    guild,
    user,
    moderator,
    reason
) {

    const data =
        getGuildData(
            guild.id
        );


    const warnings =
        getUserWarnings(
            guild.id,
            user.id
        );


    const warning = {

        id:
            data.nextWarningId,

        reason:
            reason,

        moderatorId:
            moderator.id,

        timestamp:
            Date.now()
    };


    data.nextWarningId++;


    warnings.push(
        warning
    );


    saveData(
        database
    );


    return warning;
}


// ============================================================
// REMOVE WARNING
// ============================================================

function removeWarning(
    guild,
    userId,
    warningId
) {

    const data =
        getGuildData(
            guild.id
        );


    const userData =
        data.users[userId];


    if (
        !userData ||
        !Array.isArray(
            userData.warnings
        )
    ) {

        return {
            removed: false
        };
    }


    const index =
        userData.warnings.findIndex(
            warning =>
                String(
                    warning.id
                ) === String(
                    warningId
                )
        );


    if (
        index === -1
    ) {

        return {
            removed: false
        };
    }


    const removed =
        userData.warnings.splice(
            index,
            1
        )[0];


    saveData(
        database
    );


    return {
        removed: true,
        warning: removed
    };
}


// ============================================================
// REMOVE ALL WARNINGS FROM USER
// ============================================================

function removeAllWarningsFromUser(
    guild,
    userId
) {

    const data =
        getGuildData(
            guild.id
        );


    if (
        !data.users[userId]
    ) {

        return 0;
    }


    const count =
        Array.isArray(
            data.users[userId].warnings
        )
            ? data.users[userId].warnings.length
            : 0;


    delete data.users[userId];


    saveData(
        database
    );


    return count;
}


// ============================================================
// REMOVE ALL WARNINGS FROM SERVER
// ============================================================

function removeAllWarningsFromGuild(
    guild
) {

    const data =
        getGuildData(
            guild.id
        );


    let removed =
        0;


    for (
        const userId
        of Object.keys(
            data.users
        )
    ) {

        if (
            Array.isArray(
                data.users[userId].warnings
            )
        ) {

            removed +=
                data.users[userId]
                    .warnings.length;
        }
    }


    data.users = {};


    saveData(
        database
    );


    return removed;
}


// ============================================================
// WARN COMMAND
// ============================================================

const warnCommand =
    new SlashCommandBuilder()
        .setName(
            "warn"
        )
        .setDescription(
            "Warn a user."
        )
        .addUserOption(
            option =>
                option
                    .setName(
                        "user"
                    )
                    .setDescription(
                        "The user to warn."
                    )
                    .setRequired(true)
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "reason"
                    )
                    .setDescription(
                        "Reason for the warning."
                    )
                    .setRequired(true)
                    .setMaxLength(
                        1000
                    )
        );


// ============================================================
// UNWARN COMMAND
// ============================================================

const unwarnCommand =
    new SlashCommandBuilder()
        .setName(
            "unwarn"
        )
        .setDescription(
            "Remove a warning from a user."
        )
        .addUserOption(
            option =>
                option
                    .setName(
                        "user"
                    )
                    .setDescription(
                        "The user."
                    )
                    .setRequired(true)
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "warn"
                    )
                    .setDescription(
                        "Warning ID to remove, or all."
                    )
                    .setRequired(true)
        );


// ============================================================
// UNWARN ALL COMMAND
// ============================================================

const unwarnAllCommand =
    new SlashCommandBuilder()
        .setName(
            "unwarn-all"
        )
        .setDescription(
            "Remove every warning from every user in this server."
        );


// ============================================================
// PERMISSIONS COMMAND
// ============================================================

const permissionsCommand =
    new SlashCommandBuilder()
        .setName(
            "permissions"
        )
        .setDescription(
            "Manage Nexona custom permissions."
        )
        .addRoleOption(
            option =>
                option
                    .setName(
                        "role"
                    )
                    .setDescription(
                        "The role."
                    )
                    .setRequired(true)
        )
        .addStringOption(
            option =>
                option
                    .setName(
                        "perms"
                    )
                    .setDescription(
                        "Nexona permission to give/remove."
                    )
                    .setRequired(true)
                    .addChoices(
                        {
                            name:
                                "Warn",
                            value:
                                "warn"
                        }
                    )
        )
        .addBooleanOption(
            option =>
                option
                    .setName(
                        "remove"
                    )
                    .setDescription(
                        "True = remove permission. False = give permission."
                    )
                    .setRequired(false)
        );


// ============================================================
// COMMANDS
// ============================================================

const commands = [

    warnCommand,

    unwarnCommand,

    unwarnAllCommand,

    permissionsCommand

];


// ============================================================
// INTERACTION HANDLER
// ============================================================

function install(client) {

    if (
        client.__nexonaWarningInstalled
    ) {
        return;
    }


    client.__nexonaWarningInstalled =
        true;


    client.on(
        "interactionCreate",
        async interaction => {

            if (
                !interaction.isChatInputCommand()
            ) {
                return;
            }


            if (
                ![
                    "warn",
                    "unwarn",
                    "unwarn-all",
                    "permissions"
                ].includes(
                    interaction.commandName
                )
            ) {
                return;
            }


            try {

                // =================================================
                // GUILD ONLY
                // =================================================

                if (
                    !interaction.guild
                ) {

                    return interaction.reply({
                        content:
                            "This command can only be used inside a server.",
                        ephemeral: true
                    });
                }


                // =================================================
                // /warn
                // =================================================

                if (
                    interaction.commandName ===
                    "warn"
                ) {

                    if (
                        !hasNexonaPermission(
                            interaction,
                            "warn"
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "You do not have the Nexona `warn` permission.",
                            ephemeral: true
                        });
                    }


                    const user =
                        interaction.options
                            .getUser(
                                "user"
                            );


                    const reason =
                        interaction.options
                            .getString(
                                "reason"
                            );


                    // Reason is required.
                    if (
                        !reason ||
                        !reason.trim()
                    ) {

                        return interaction.reply({
                            content:
                                "A reason is required. The warning was not recorded.",
                            ephemeral: true
                        });
                    }


                    const member =
                        await interaction.guild
                            .members
                            .fetch(
                                user.id
                            )
                            .catch(
                                () => null
                            );


                    if (
                        !member
                    ) {

                        return interaction.reply({
                            content:
                                "That user is not in this server.",
                            ephemeral: true
                        });
                    }


                    // Do not warn the bot.
                    if (
                        user.bot
                    ) {

                        return interaction.reply({
                            content:
                                "You cannot warn a bot.",
                            ephemeral: true
                        });
                    }


                    const warning =
                        addWarning(
                            interaction.guild,
                            user,
                            interaction.user,
                            reason.trim()
                        );


                    const warningCount =
                        getUserWarnings(
                            interaction.guild.id,
                            user.id
                        ).length;


                    // =================================================
                    // PUBLIC MESSAGE
                    // =================================================

                    await interaction.channel
                        .send({
                            content:
                                `${user} was warned.\nthey now have ${warningCount}`
                        })
                        .catch(
                            error =>
                                console.error(
                                    "Failed to send public warning message:",
                                    error
                                )
                        );


                    // =================================================
                    // DM
                    // =================================================

                    const dmEmbed =
                        new EmbedBuilder()
                            .setTitle(
                                "Nexona Warning"
                            )
                            .setDescription(
                                `hello ${user}!\n\nyou have been warned in ${interaction.guild.name} with the reason (${reason.trim()})\nyou now have ${warningCount} warnings`
                            )
                            .setTimestamp();


                    await user
                        .send({
                            embeds: [
                                dmEmbed
                            ]
                        })
                        .catch(
                            () => {}
                        );


                    // =================================================
                    // COMMAND RESPONSE
                    // =================================================

                    return interaction.reply({
                        content:
                            `Warning #${warning.id} added to ${user}.`,
                        ephemeral: true
                    });
                }


                // =================================================
                // /unwarn
                // =================================================

                if (
                    interaction.commandName ===
                    "unwarn"
                ) {

                    if (
                        !hasNexonaPermission(
                            interaction,
                            "warn"
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "You do not have the Nexona `warn` permission.",
                            ephemeral: true
                        });
                    }


                    const user =
                        interaction.options
                            .getUser(
                                "user"
                            );


                    const warn =
                        interaction.options
                            .getString(
                                "warn"
                            )
                            .trim()
                            .toLowerCase();


                    const warnings =
                        getUserWarnings(
                            interaction.guild.id,
                            user.id
                        );


                    // =================================================
                    // ALL
                    // =================================================

                    if (
                        warn ===
                        "all"
                    ) {

                        if (
                            warnings.length ===
                            0
                        ) {

                            return interaction.reply({
                                content:
                                    "That user has no warnings.",
                                ephemeral: true
                            });
                        }


                        removeAllWarningsFromUser(
                            interaction.guild,
                            user.id
                        );


                        const warningCount =
                            0;


                        await interaction.channel
                            .send({
                                content:
                                    `${user}'s warning has been removed\nthey now have ${warningCount}`
                            })
                            .catch(
                                () => {}
                            );


                        return interaction.reply({
                            content:
                                `Removed all warnings from ${user}.`,
                            ephemeral: true
                        });
                    }


                    // =================================================
                    // SINGLE WARNING
                    // =================================================

                    const warningId =
                        Number(
                            warn
                        );


                    if (
                        !Number.isInteger(
                            warningId
                        ) ||
                        warningId <= 0
                    ) {

                        return interaction.reply({
                            content:
                                "Invalid warning. Use a warning ID such as `1`, `2`, `3`, or use `all`.",
                            ephemeral: true
                        });
                    }


                    const result =
                        removeWarning(
                            interaction.guild,
                            user.id,
                            warningId
                        );


                    if (
                        !result.removed
                    ) {

                        return interaction.reply({
                            content:
                                `Warning #${warningId} was not found for that user.`,
                            ephemeral: true
                        });
                    }


                    const warningCount =
                        getUserWarnings(
                            interaction.guild.id,
                            user.id
                        ).length;


                    // =================================================
                    // PUBLIC MESSAGE
                    // =================================================

                    await interaction.channel
                        .send({
                            content:
                                `${user}'s warning has been removed\nthey now have ${warningCount}`
                        })
                        .catch(
                            () => {}
                        );


                    return interaction.reply({
                        content:
                            `Removed warning #${warningId} from ${user}.`,
                        ephemeral: true
                    });
                }


                // =================================================
                // /unwarn-all
                // =================================================

                if (
                    interaction.commandName ===
                    "unwarn-all"
                ) {

                    if (
                        !isModerator(
                            interaction
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "You need the Moderator permission to use this command.",
                            ephemeral: true
                        });
                    }


                    const removed =
                        removeAllWarningsFromGuild(
                            interaction.guild
                        );


                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    "Nexona Warnings"
                                )
                                .setDescription(
                                    `All warnings have been removed from this server.\n\n**Warnings removed:** ${removed}`
                                )
                                .setTimestamp()
                        ],
                        ephemeral: true
                    });
                }


                // =================================================
                // /permissions
                // =================================================

                if (
                    interaction.commandName ===
                    "permissions"
                ) {

                    if (
                        !isModerator(
                            interaction
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "You need the Moderator permission to manage Nexona permissions.",
                            ephemeral: true
                        });
                    }


                    const role =
                        interaction.options
                            .getRole(
                                "role"
                            );


                    const permission =
                        interaction.options
                            .getString(
                                "perms"
                            );


                    const remove =
                        interaction.options
                            .getBoolean(
                                "remove"
                            ) || false;


                    const data =
                        getGuildData(
                            interaction.guild.id
                        );


                    if (
                        !data.permissions[
                            permission
                        ]
                    ) {

                        data.permissions[
                            permission
                        ] = [];
                    }


                    const roleList =
                        data.permissions[
                            permission
                        ];


                    // =================================================
                    // REMOVE
                    // =================================================

                    if (
                        remove
                    ) {

                        if (
                            !roleList.includes(
                                role.id
                            )
                        ) {

                            return interaction.reply({
                                content:
                                    `${role} does not have the Nexona \`${permission}\` permission.`,
                                ephemeral: true
                            });
                        }


                        data.permissions[
                            permission
                        ] =
                            roleList.filter(
                                id =>
                                    id !==
                                    role.id
                            );


                        saveData(
                            database
                        );


                        return interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle(
                                        "Nexona Permissions"
                                    )
                                    .setDescription(
                                        `${role} no longer has the Nexona \`${permission}\` permission.`
                                    )
                                    .setTimestamp()
                            ],
                            ephemeral: true
                        });
                    }


                    // =================================================
                    // GIVE
                    // =================================================

                    if (
                        roleList.includes(
                            role.id
                        )
                    ) {

                        return interaction.reply({
                            content:
                                `${role} already has the Nexona \`${permission}\` permission.`,
                            ephemeral: true
                        });
                    }


                    roleList.push(
                        role.id
                    );


                    saveData(
                        database
                    );


                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    "Nexona Permissions"
                                )
                                .setDescription(
                                    `${role} now has the Nexona \`${permission}\` permission.`
                                )
                                .setTimestamp()
                        ],
                        ephemeral: true
                    });
                }

            } catch (error) {

                console.error(
                    "NEXONA WARNING ERROR:",
                    error
                );


                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.followUp({
                        content:
                            "Nexona encountered an error while processing the warning command.",
                        ephemeral: true
                    }).catch(
                        () => {}
                    );

                } else {

                    await interaction.reply({
                        content:
                            "Nexona encountered an error while processing the warning command.",
                        ephemeral: true
                    }).catch(
                        () => {}
                    );
                }
            }
        }
    );
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
    commands,
    install,
    addWarning,
    removeWarning,
    removeAllWarningsFromUser,
    removeAllWarningsFromGuild,
    hasNexonaPermission
};