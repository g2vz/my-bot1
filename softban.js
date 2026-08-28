const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ============================================================
// NEXONA SOFTBAN SYSTEM
// ============================================================

const SOFTBAN_ROLE_NAME = "softban";

const DATA_FILE = path.join(
    __dirname,
    "softban.json"
);


// ============================================================
// JSON DATABASE
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
            "Failed to load softban.json:",
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
            roleId: null,

            users: {}
        };

        saveData(database);
    }

    return database[guildId];
}


// ============================================================
// FIND SOFTBAN ROLE
// ============================================================

function getSoftbanRole(guild) {

    const data =
        getGuildData(guild.id);

    // First try saved role ID.
    if (data.roleId) {

        const role =
            guild.roles.cache.get(
                data.roleId
            );

        if (role) {
            return role;
        }
    }

    // Otherwise search by name.
    const role =
        guild.roles.cache.find(
            r =>
                r.name.toLowerCase() ===
                SOFTBAN_ROLE_NAME.toLowerCase()
        );

    if (role) {

        data.roleId =
            role.id;

        saveData(database);

        return role;
    }

    return null;
}


// ============================================================
// CREATE SOFTBAN ROLE
// ============================================================

async function createSoftbanRole(guild) {

    const existing =
        getSoftbanRole(guild);

    // If it already exists, do nothing.
    if (existing) {
        return {
            role: existing,
            created: false
        };
    }

    const role =
        await guild.roles.create({

            name:
                SOFTBAN_ROLE_NAME,

            // Do not give the role any permissions.
            permissions: [],

            reason:
                "Nexona Softban role"
        });

    const data =
        getGuildData(guild.id);

    data.roleId =
        role.id;

    saveData(database);

    return {
        role,
        created: true
    };
}


// ============================================================
// ROLE PERMISSION CHECK
// ============================================================

function canUseSoftban(interaction) {

    return interaction.memberPermissions?.has(
        PermissionFlagsBits.BanMembers
    );
}


// ============================================================
// SAVE USER ROLES
// ============================================================
//
// We save every role except:
// - @everyone
// - the Softban role
//
// The role IDs are saved so they can be restored later.
// ============================================================

function getRestorableRoles(member, softbanRoleId) {

    return member.roles.cache
        .filter(
            role =>
                role.id !== member.guild.id &&
                role.id !== softbanRoleId
        )
        .map(
            role =>
                role.id
        );
}


// ============================================================
// ADD SOFTBAN
// ============================================================

async function softbanAdd(
    guild,
    member,
    reason
) {

    const data =
        getGuildData(
            guild.id
        );

    const role =
        getSoftbanRole(
            guild
        );

    if (!role) {
        throw new Error(
            "The Softban role does not exist. Use /softban first."
        );
    }


    // ----------------------------------------------------------
    // Already Softbanned
    // ----------------------------------------------------------

    if (
        member.roles.cache.has(
            role.id
        )
    ) {
        return {
            success: false,
            alreadySoftbanned: true
        };
    }


    // ----------------------------------------------------------
    // Save current roles
    // ----------------------------------------------------------

    const roles =
        getRestorableRoles(
            member,
            role.id
        );

    data.users[member.id] = {
        roles,
        reason:
            reason ||
            "No reason provided",
        timestamp:
            Date.now()
    };

    saveData(
        database
    );


    // ----------------------------------------------------------
    // Remove all roles
    // ----------------------------------------------------------

    //
    // Discord does not allow a bot to remove roles
    // higher than the bot's highest role.
    //
    // remove() is attempted individually so one
    // unmanageable role does not prevent the rest.
    //

    for (
        const roleId
        of roles
    ) {

        const oldRole =
            guild.roles.cache.get(
                roleId
            );

        if (!oldRole) {
            continue;
        }

        if (!oldRole.editable) {
            continue;
        }

        await member.roles
            .remove(
                oldRole,
                "Nexona Softban"
            )
            .catch(
                error =>
                    console.error(
                        `Failed to remove role ${oldRole.name}:`,
                        error
                    )
            );
    }


    // ----------------------------------------------------------
    // Add Softban role
    // ----------------------------------------------------------

    await member.roles
        .add(
            role,
            reason ||
                "Nexona Softban"
        );


    return {
        success: true,
        alreadySoftbanned: false,
        role,
        removedRoles: roles
    };
}


// ============================================================
// REMOVE SOFTBAN
// ============================================================

async function softbanRemove(
    guild,
    member
) {

    const data =
        getGuildData(
            guild.id
        );

    const role =
        getSoftbanRole(
            guild
        );

    if (!role) {
        return {
            success: false,
            notSoftbanned: true
        };
    }


    // ----------------------------------------------------------
    // Check if user actually has Softban
    // ----------------------------------------------------------

    if (
        !member.roles.cache.has(
            role.id
        )
    ) {
        return {
            success: false,
            notSoftbanned: true
        };
    }


    // ----------------------------------------------------------
    // Remove Softban role
    // ----------------------------------------------------------

    if (
        role.editable
    ) {

        await member.roles
            .remove(
                role,
                "Nexona Softban removal"
            )
            .catch(
                error =>
                    console.error(
                        "Failed to remove Softban role:",
                        error
                    )
            );
    }


    // ----------------------------------------------------------
    // Restore previous roles
    // ----------------------------------------------------------

    const saved =
        data.users[member.id];


    if (saved) {

        for (
            const roleId
            of saved.roles
        ) {

            const oldRole =
                guild.roles.cache.get(
                    roleId
                );

            if (!oldRole) {
                continue;
            }

            // Do not attempt roles the bot cannot manage.
            if (!oldRole.editable) {
                continue;
            }

            await member.roles
                .add(
                    oldRole,
                    "Nexona Softban role restoration"
                )
                .catch(
                    error =>
                        console.error(
                            `Failed to restore role ${oldRole.name}:`,
                            error
                        )
                );
        }


        // Delete saved data after restoration.
        delete data.users[member.id];

        saveData(
            database
        );
    }


    return {
        success: true,
        notSoftbanned: false
    };
}


// ============================================================
// COMMANDS
// ============================================================

const commands = [

    // ========================================================
    // /softban
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "softban"
        )
        .setDescription(
            "Create the Softban role if it does not already exist."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.BanMembers.toString()
        ),


    // ========================================================
    // /softban-add
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "softban-add"
        )
        .setDescription(
            "Add a user to Softban and remove their other roles."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.BanMembers.toString()
        )
        .addUserOption(
            option =>
                option
                    .setName(
                        "user"
                    )
                    .setDescription(
                        "The user to Softban."
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
                        "Reason for the Softban."
                    )
                    .setRequired(false)
                    .setMaxLength(
                        1000
                    )
        ),


    // ========================================================
    // /softban-remove
    // ========================================================

    new SlashCommandBuilder()
        .setName(
            "softban-remove"
        )
        .setDescription(
            "Remove Softban and restore the user's previous roles."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.BanMembers.toString()
        )
        .addUserOption(
            option =>
                option
                    .setName(
                        "user"
                    )
                    .setDescription(
                        "The user to remove from Softban."
                    )
                    .setRequired(true)
        )
];


// ============================================================
// INTERACTION HANDLER
// ============================================================

function install(client) {

    // Prevent duplicate installation.
    if (
        client.__nexonaSoftbanInstalled
    ) {
        return;
    }

    client.__nexonaSoftbanInstalled =
        true;


    client.on(
        "interactionCreate",
        async interaction => {

            // Only handle slash commands.
            if (
                !interaction.isChatInputCommand()
            ) {
                return;
            }

            // Only our commands.
            if (
                ![
                    "softban",
                    "softban-add",
                    "softban-remove"
                ].includes(
                    interaction.commandName
                )
            ) {
                return;
            }


            try {

                // ------------------------------------------------
                // Guild only
                // ------------------------------------------------

                if (
                    !interaction.guild
                ) {
                    return interaction.reply({
                        content:
                            "This command can only be used inside a server.",
                        ephemeral: true
                    });
                }


                // ------------------------------------------------
                // Permission
                // ------------------------------------------------

                if (
                    !canUseSoftban(
                        interaction
                    )
                ) {
                    return interaction.reply({
                        content:
                            "You need the Ban Members permission to use Softban commands.",
                        ephemeral: true
                    });
                }


                // =================================================
                // /softban
                // =================================================

                if (
                    interaction.commandName ===
                    "softban"
                ) {

                    const result =
                        await createSoftbanRole(
                            interaction.guild
                        );


                    if (
                        result.created
                    ) {

                        return interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle(
                                        "Nexona Softban"
                                    )
                                    .setDescription(
                                        `The ${result.role} role has been created.`
                                    )
                                    .setTimestamp()
                            ],
                            ephemeral: true
                        });

                    }


                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    "Nexona Softban"
                                )
                                .setDescription(
                                    `The ${result.role} role already exists. Nothing was changed.`
                                )
                                .setTimestamp()
                        ],
                        ephemeral: true
                    });
                }


                // =================================================
                // Make sure role exists
                // =================================================

                const role =
                    getSoftbanRole(
                        interaction.guild
                    );


                if (!role) {

                    return interaction.reply({
                        content:
                            "The Softban role does not exist yet. Use /softban first.",
                        ephemeral: true
                    });
                }


                // =================================================
                // /softban-add
                // =================================================

                if (
                    interaction.commandName ===
                    "softban-add"
                ) {

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


                    const member =
                        await interaction.guild
                            .members
                            .fetch(
                                user.id
                            )
                            .catch(
                                () => null
                            );


                    if (!member) {

                        return interaction.reply({
                            content:
                                "That user is not in this server.",
                            ephemeral: true
                        });
                    }


                    // ------------------------------------------------
                    // Already Softbanned
                    // ------------------------------------------------

                    if (
                        member.roles.cache.has(
                            role.id
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "the user you chose is already in softban",
                            ephemeral: true
                        });
                    }


                    // ------------------------------------------------
                    // Prevent Softbanning yourself
                    // ------------------------------------------------

                    if (
                        member.id ===
                        interaction.user.id
                    ) {

                        return interaction.reply({
                            content:
                                "You cannot Softban yourself.",
                            ephemeral: true
                        });
                    }


                    // ------------------------------------------------
                    // Execute
                    // ------------------------------------------------

                    const result =
                        await softbanAdd(
                            interaction.guild,
                            member,
                            reason
                        );


                    if (
                        !result.success
                    ) {

                        return interaction.reply({
                            content:
                                "the user you chose is already in softban",
                            ephemeral: true
                        });
                    }


                    // ------------------------------------------------
                    // Public announcement
                    // ------------------------------------------------

                    const publicEmbed =
                        new EmbedBuilder()
                            .setDescription(
                                `${member} was added to softban. please be careful and re read the rules i heard that the softban is hell💔`
                            )
                            .setTimestamp();


                    await interaction.channel
                        .send({
                            embeds: [
                                publicEmbed
                            ]
                        })
                        .catch(
                            error =>
                                console.error(
                                    "Failed to send public Softban message:",
                                    error
                                )
                        );


                    // ------------------------------------------------
                    // DM
                    // ------------------------------------------------

                    const dmEmbed =
                        new EmbedBuilder()
                            .setTitle(
                                "Nexona Softban"
                            )
                            .setDescription(
                                `idk what you did dude but you've been softbanned in ${interaction.guild.name}\n\nplease check the only available channel so you can appeal the ban!`
                            )
                            .setTimestamp();


                    await member
                        .send({
                            embeds: [
                                dmEmbed
                            ]
                        })
                        .catch(
                            () => {}
                        );


                    // ------------------------------------------------
                    // Command response
                    // ------------------------------------------------

                    return interaction.reply({
                        content:
                            `Softbanned ${member}.`,
                        ephemeral: true
                    });
                }


                // =================================================
                // /softban-remove
                // =================================================

                if (
                    interaction.commandName ===
                    "softban-remove"
                ) {

                    const user =
                        interaction.options
                            .getUser(
                                "user"
                            );


                    const member =
                        await interaction.guild
                            .members
                            .fetch(
                                user.id
                            )
                            .catch(
                                () => null
                            );


                    if (!member) {

                        return interaction.reply({
                            content:
                                "That user is not in this server.",
                            ephemeral: true
                        });
                    }


                    // ------------------------------------------------
                    // Not Softbanned
                    // ------------------------------------------------

                    if (
                        !member.roles.cache.has(
                            role.id
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "the user you chose isn't even in softban blud💔🥀",
                            ephemeral: true
                        });
                    }


                    // ------------------------------------------------
                    // Execute
                    // ------------------------------------------------

                    const result =
                        await softbanRemove(
                            interaction.guild,
                            member
                        );


                    if (
                        !result.success
                    ) {

                        return interaction.reply({
                            content:
                                "the user you chose isn't even in softban blud💔🥀",
                            ephemeral: true
                        });
                    }


                    // ------------------------------------------------
                    // Public announcement
                    // ------------------------------------------------

                    const publicEmbed =
                        new EmbedBuilder()
                            .setDescription(
                                `${member}'s softban has been removed.`
                            )
                            .setTimestamp();


                    await interaction.channel
                        .send({
                            embeds: [
                                publicEmbed
                            ]
                        })
                        .catch(
                            error =>
                                console.error(
                                    "Failed to send public Softban removal message:",
                                    error
                                )
                        );


                    // ------------------------------------------------
                    // DM
                    // ------------------------------------------------

                    const dmEmbed =
                        new EmbedBuilder()
                            .setTitle(
                                "Nexona Softban"
                            )
                            .setDescription(
                                `your softban is now gone, read the rules so you don't get softbanned again!❤️‍🩹\n\n${interaction.guild.name}`
                            )
                            .setTimestamp();


                    await member
                        .send({
                            embeds: [
                                dmEmbed
                            ]
                        })
                        .catch(
                            () => {}
                        );


                    // ------------------------------------------------
                    // Command response
                    // ------------------------------------------------

                    return interaction.reply({
                        content:
                            `Removed Softban from ${member} and restored their saved roles.`,
                        ephemeral: true
                    });
                }

            } catch (error) {

                console.error(
                    "NEXONA SOFTBAN ERROR:",
                    error
                );


                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.followUp({
                        content:
                            "Nexona encountered an error while processing the Softban command.",
                        ephemeral: true
                    }).catch(
                        () => {}
                    );

                } else {

                    await interaction.reply({
                        content:
                            "Nexona encountered an error while processing the Softban command.",
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
    createSoftbanRole,
    softbanAdd,
    softbanRemove
};