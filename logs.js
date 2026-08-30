const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    AuditLogEvent,
    OverwriteType
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ============================================================
// NEXONA LOGS
// ============================================================

const LOGS_DATA_FILE = path.join(
    __dirname,
    "logs.json"
);

const WARNINGS_DATA_FILE = path.join(
    __dirname,
    "warnings.json"
);


// ============================================================
// CONSTANTS
// ============================================================

const CATEGORY_NAME = "logs";

const LOG_CHANNELS = {
    leave: "leave",
    warns: "warns",
    reactions: "reactions",
    messages: "messages",
    bans: "ban - kicks",
    channels: "channels"
};


// ============================================================
// JSON HELPERS
// ============================================================

function loadJSON(file) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify({}, null, 4)
        );
    }

    try {
        return JSON.parse(
            fs.readFileSync(
                file,
                "utf8"
            )
        );
    } catch {
        return {};
    }
}


function saveJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(
            data,
            null,
            4
        )
    );
}


const logsDatabase =
    loadJSON(LOGS_DATA_FILE);

const warningsDatabase =
    loadJSON(WARNINGS_DATA_FILE);


// ============================================================
// DEFAULT GUILD DATA
// ============================================================

function getGuildLogsData(guildId) {
    if (
        !logsDatabase[guildId]
    ) {
        logsDatabase[guildId] = {
            enabled: false,
            roleId: null,
            categoryId: null,
            channels: {}
        };

        saveJSON(
            LOGS_DATA_FILE,
            logsDatabase
        );
    }

    return logsDatabase[guildId];
}


function getGuildWarnings(guildId) {
    if (
        !warningsDatabase[guildId]
    ) {
        warningsDatabase[guildId] = {};
    }

    return warningsDatabase[guildId];
}


// ============================================================
// UTILITIES
// ============================================================

function truncate(text, length = 1024) {
    if (!text) {
        return "No content";

    }

    text = String(text);

    if (
        text.length <= length
    ) {
        return text;
    }

    return (
        text.slice(
            0,
            length - 3
        ) + "..."
    );
}


function userMention(id) {
    return id
        ? `<@${id}>`
        : "Unknown member";
}


function channelMention(id) {
    return id
        ? `<#${id}>`
        : "Unknown channel";
}


function roleMention(id) {
    return id
        ? `<@&${id}>`
        : "Unknown role";
}


function messageLink(
    guildId,
    channelId,
    messageId
) {
    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}


function timeAgo(date) {
    const seconds =
        Math.floor(
            (Date.now() - date.getTime()) /
            1000
        );

    if (seconds < 60) {
        return `${seconds} seconds ago`;
    }

    const minutes =
        Math.floor(
            seconds / 60
        );

    if (minutes < 60) {
        return `${minutes} minutes ago`;
    }

    const hours =
        Math.floor(
            minutes / 60
        );

    if (hours < 24) {
        return `${hours} hours ago`;
    }

    const days =
        Math.floor(
            hours / 24
        );

    if (days < 30) {
        return `${days} days ago`;
    }

    const months =
        Math.floor(
            days / 30
        );

    if (months < 12) {
        return `${months} months ago`;
    }

    const years =
        Math.floor(
            months / 12
        );

    return `${years} years ago`;
}


// ============================================================
// GET LOG CHANNEL
// ============================================================

function getLogChannel(
    guild,
    type
) {
    const data =
        getGuildLogsData(
            guild.id
        );

    const channelId =
        data.channels?.[type];

    if (!channelId) {
        return null;
    }

    return guild.channels.cache.get(
        channelId
    ) || null;
}


// ============================================================
// SEND LOG
// ============================================================

async function sendLog(
    guild,
    type,
    embed
) {
    const channel =
        getLogChannel(
            guild,
            type
        );

    if (!channel) {
        return;
    }

    await channel.send({
        embeds: [embed]
    }).catch(() => {});
}


// ============================================================
// CREATE LOG STRUCTURE
// ============================================================

async function createLogs(
    guild,
    role
) {

    // --------------------------------------------------------
    // Find/create category
    // --------------------------------------------------------

    let category =
        guild.channels.cache.find(
            channel =>
                channel.type ===
                ChannelType.GuildCategory &&
                channel.name.toLowerCase() ===
                CATEGORY_NAME
        );

    const everyone =
        guild.roles.everyone;

    const permissionOverwrites = [
        {
            id: everyone.id,
            deny: [
                PermissionFlagsBits.ViewChannel
            ]
        },
        {
            id: role.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },
        {
            id: guild.members.me.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ReadMessageHistory
            ]
        }
    ];

    if (!category) {

        category =
            await guild.channels.create({
                name: CATEGORY_NAME,
                type: ChannelType.GuildCategory,
                permissionOverwrites,
                reason:
                    "Nexona Auto Logs"
            });

    } else {

        await category.permissionOverwrites
            .set(
                permissionOverwrites,
                "Nexona Auto Logs"
            )
            .catch(() => {});
    }


    // --------------------------------------------------------
    // Create channels
    // --------------------------------------------------------

    const createdChannels = {};

    for (
        const type
        of Object.keys(LOG_CHANNELS)
    ) {

        const channelName =
            LOG_CHANNELS[type];

        let channel =
            guild.channels.cache.find(
                ch =>
                    ch.parentId === category.id &&
                    ch.name === channelName &&
                    ch.type === ChannelType.GuildText
            );

        if (!channel) {

            channel =
                await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites,
                    reason:
                        "Nexona Auto Logs"
                });

        } else {

            await channel.permissionOverwrites
                .set(
                    permissionOverwrites,
                    "Nexona Auto Logs"
                )
                .catch(() => {});
        }

        createdChannels[type] =
            channel.id;
    }


    // --------------------------------------------------------
    // Save
    // --------------------------------------------------------

    const data =
        getGuildLogsData(
            guild.id
        );

    data.enabled = true;
    data.roleId = role.id;
    data.categoryId = category.id;
    data.channels = createdChannels;

    saveJSON(
        LOGS_DATA_FILE,
        logsDatabase
    );

    return {
        category,
        channels: createdChannels
    };
}


// ============================================================
// AUDIT LOG HELPER
// ============================================================

async function findAuditExecutor(
    guild,
    type,
    targetId,
    maxAge = 5000
) {

    try {

        const audit =
            await guild.fetchAuditLogs({
                type,
                limit: 10
            });

        const now =
            Date.now();

        const entry =
            audit.entries.find(
                entry => {

                    if (
                        targetId &&
                        entry.targetId !==
                        targetId
                    ) {
                        return false;
                    }

                    return (
                        now -
                        entry.createdTimestamp
                    ) <= maxAge;
                }
            );

        return entry || null;

    } catch (error) {

        console.error(
            "NEXONA AUDIT LOG ERROR:",
            error
        );

        return null;
    }
}


// ============================================================
// LEAVE LOG
// ============================================================

async function handleMemberRemove(
    member
) {

    if (!member.guild) {
        return;
    }

    const embed =
        new EmbedBuilder()
            .setColor(0xff5555)
            .setTitle(
                "a member have left the server☹️!"
            )
            .setDescription(
                `member is ${userMention(member.id)}\n\n` +
                `HOPE YOU COME BACK SOON!`
            )
            .setThumbnail(
                member.user?.displayAvatarURL({
                    extension: "png",
                    size: 256
                }) || null
            )
            .setTimestamp();

    await sendLog(
        member.guild,
        "leave",
        embed
    );
}


// ============================================================
// WARN SYSTEM
// ============================================================

async function warnMember(
    guild,
    member,
    staff,
    reason
) {

    const guildWarnings =
        getGuildWarnings(
            guild.id
        );

    if (
        !guildWarnings[member.id]
    ) {
        guildWarnings[member.id] = [];
    }

    const warning = {
        id:
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

        reason:
            reason || "No reason provided",

        staffId:
            staff.id,

        timestamp:
            Date.now()
    };

    guildWarnings[member.id].push(
        warning
    );

    saveJSON(
        WARNINGS_DATA_FILE,
        warningsDatabase
    );

    const count =
        guildWarnings[member.id].length;

    const embed =
        new EmbedBuilder()
            .setColor(0xffcc00)
            .setTitle(
                "a member have been warned‼️"
            )
            .setDescription(
                `${userMention(member.id)} have been warned by ${userMention(staff.id)}\n\n` +
                `reason (${truncate(reason || "No reason provided", 800)})\n\n` +
                `they now have **${count}** warning${count === 1 ? "" : "s"}`
            )
            .setTimestamp();

    await sendLog(
        guild,
        "warns",
        embed
    );

    return count;
}


// ============================================================
// REACTION ADD
// ============================================================

async function handleReactionAdd(
    reaction,
    user
) {

    if (
        user.bot ||
        !reaction.message.guild
    ) {
        return;
    }

    const message =
        reaction.message;

    const emoji =
        reaction.emoji.toString();

    const embed =
        new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(
                "an emoji was react to a message in"
            )
            .setDescription(
                `${messageLink(
                    message.guild.id,
                    message.channel.id,
                    message.id
                )}\n\n` +
                `emoji ${emoji}\n` +
                `member ${userMention(user.id)}`
            )
            .setTimestamp();

    await sendLog(
        message.guild,
        "reactions",
        embed
    );
}


// ============================================================
// REACTION REMOVE
// ============================================================

async function handleReactionRemove(
    reaction,
    user
) {

    if (
        user.bot ||
        !reaction.message.guild
    ) {
        return;
    }

    const message =
        reaction.message;

    const emoji =
        reaction.emoji.toString();

    const embed =
        new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle(
                "a reaction was deleted in"
            )
            .setDescription(
                `${messageLink(
                    message.guild.id,
                    message.channel.id,
                    message.id
                )}\n\n` +
                `emoji ${emoji}\n` +
                `member ${userMention(user.id)}`
            )
            .setTimestamp();

    await sendLog(
        message.guild,
        "reactions",
        embed
    );
}


// ============================================================
// MESSAGE CACHE
// ============================================================

const messageCache =
    new Map();


// ============================================================
// MESSAGE CREATE
// ============================================================

async function handleMessageCreate(
    message
) {

    if (
        !message.guild ||
        message.author.bot
    ) {
        return;
    }

    messageCache.set(
        message.id,
        {
            content:
                message.content,

            authorId:
                message.author.id,

            channelId:
                message.channel.id,

            createdAt:
                Date.now()
        }
    );

    // Prevent unlimited memory usage.
    setTimeout(
        () => {
            messageCache.delete(
                message.id
            );
        },
        15 * 60 * 1000
    );
}


// ============================================================
// MESSAGE DELETE
// ============================================================

async function handleMessageDelete(
    message
) {

    if (!message.guild) {
        return;
    }

    const cached =
        messageCache.get(
            message.id
        );

    const content =
        message.content ||
        cached?.content ||
        "[message content unavailable]";

    const memberId =
        message.author?.id ||
        cached?.authorId ||
        null;

    let deletedBy =
        `${message.guild.name} auto mod`;

    let deletedById =
        null;


    // --------------------------------------------------------
    // Check audit log
    // --------------------------------------------------------

    const audit =
        await findAuditExecutor(
            message.guild,
            AuditLogEvent.MessageDelete,
            message.id,
            5000
        );

    if (
        audit?.executor
    ) {
        deletedBy =
            userMention(
                audit.executor.id
            );

        deletedById =
            audit.executor.id;
    }


    // --------------------------------------------------------
    // Detect Nexona AutoMod
    // --------------------------------------------------------

    // If there is no audit executor,
    // we keep the default AutoMod/server text.
    //
    // The AutoMod execution listener can also mark
    // the message as Nexona AutoMod.

    const embed =
        new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle(
                "a message have been deleted‼️"
            )
            .addFields(
                {
                    name:
                        "the message",
                    value:
                        truncate(
                            content,
                            1024
                        )
                },
                {
                    name:
                        "deleted in",
                    value:
                        channelMention(
                            message.channel?.id ||
                            cached?.channelId
                        )
                },
                {
                    name:
                        "member",
                    value:
                        memberId
                            ? userMention(memberId)
                            : "Unknown member"
                },
                {
                    name:
                        "deleted by",
                    value:
                        deletedById
                            ? userMention(deletedById)
                            : `${message.guild.name} auto mod`
                }
            )
            .setTimestamp();

    await sendLog(
        message.guild,
        "messages",
        embed
    );

    messageCache.delete(
        message.id
    );
}


// ============================================================
// MARK MESSAGE AS AUTOMOD DELETED
// ============================================================

const autoModDeletedMessages =
    new Set();


function markAutoModDeleted(
    messageId
) {
    autoModDeletedMessages.add(
        messageId
    );

    setTimeout(
        () => {
            autoModDeletedMessages.delete(
                messageId
            );
        },
        15000
    );
}


// ============================================================
// MESSAGE EDIT
// ============================================================

async function handleMessageUpdate(
    oldMessage,
    newMessage
) {

    if (
        !newMessage.guild
    ) {
        return;
    }

    if (
        newMessage.author?.bot
    ) {
        return;
    }

    const oldContent =
        oldMessage.content ||
        "";

    const newContent =
        newMessage.content ||
        "";

    if (
        oldContent ===
        newContent
    ) {
        return;
    }

    const embed =
        new EmbedBuilder()
            .setColor(0x808080)
            .setTitle(
                "a message was edited"
            )
            .setDescription(
                `**${truncate(oldContent, 900)}**\n\n` +
                `to\n\n` +
                `**${truncate(newContent, 900)}**\n\n` +
                `${messageLink(
                    newMessage.guild.id,
                    newMessage.channel.id,
                    newMessage.id
                )}\n\n` +
                `member ${userMention(
                    newMessage.author?.id
                )}`
            )
            .setTimestamp();

    await sendLog(
        newMessage.guild,
        "messages",
        embed
    );
}


// ============================================================
// BAN / KICK LOG
// ============================================================

async function handleBan(
    ban
) {

    const guild =
        ban.guild;

    const audit =
        await findAuditExecutor(
            guild,
            AuditLogEvent.MemberBanAdd,
            ban.user.id,
            7000
        );

    const staff =
        audit?.executor;

    const embed =
        new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle(
                "a member was banned"
            )
            .setDescription(
                `staff ${staff ? userMention(staff.id) : "Unknown"}\n` +
                `member ${userMention(ban.user.id)}`
            )
            .setTimestamp();

    await sendLog(
        guild,
        "bans",
        embed
    );
}


async function handleKick(
    member
) {

    const guild =
        member.guild;

    const audit =
        await findAuditExecutor(
            guild,
            AuditLogEvent.MemberKick,
            member.id,
            7000
        );

    const staff =
        audit?.executor;

    const embed =
        new EmbedBuilder()
            .setColor(0x808080)
            .setTitle(
                "a member was kicked"
            )
            .setDescription(
                `staff ${staff ? userMention(staff.id) : "Unknown"}\n` +
                `member ${userMention(member.id)}`
            )
            .setTimestamp();

    await sendLog(
        guild,
        "bans",
        embed
    );
}


// ============================================================
// CHANNEL CREATE
// ============================================================

async function handleChannelCreate(
    channel
) {

    if (
        !channel.guild
    ) {
        return;
    }

    const audit =
        await findAuditExecutor(
            channel.guild,
            AuditLogEvent.ChannelCreate,
            channel.id,
            7000
        );

    const creator =
        audit?.executor;

    const embed =
        new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(
                "a channel have been created"
            )
            .setDescription(
                `channel ${channelMention(channel.id)}\n` +
                `created by ${creator ? userMention(creator.id) : "Unknown"}`
            )
            .setTimestamp();

    await sendLog(
        channel.guild,
        "channels",
        embed
    );
}


// ============================================================
// CHANNEL DELETE
// ============================================================

async function handleChannelDelete(
    channel
) {

    if (
        !channel.guild
    ) {
        return;
    }

    const audit =
        await findAuditExecutor(
            channel.guild,
            AuditLogEvent.ChannelDelete,
            channel.id,
            7000
        );

    const deletedBy =
        audit?.executor;

    const createdAt =
        channel.createdAt ||
        new Date();

    const embed =
        new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle(
                "a channel have been deleted"
            )
            .setDescription(
                `deleted by ${deletedBy ? userMention(deletedBy.id) : "Unknown"}\n` +
                `channel name ${channel.name}\n` +
                `channel created ${timeAgo(createdAt)}`
            )
            .setTimestamp();

    await sendLog(
        channel.guild,
        "channels",
        embed
    );
}


// ============================================================
// CHANNEL NAME / PERMISSION UPDATE
// ============================================================

function getPermissionChanges(
    oldChannel,
    newChannel
) {

    const changes = [];

    const oldOverwrites =
        oldChannel.permissionOverwrites?.cache;

    const newOverwrites =
        newChannel.permissionOverwrites?.cache;

    if (
        !oldOverwrites ||
        !newOverwrites
    ) {
        return changes;
    }

    const ids =
        new Set([
            ...oldOverwrites.keys(),
            ...newOverwrites.keys()
        ]);

    for (
        const id
        of ids
    ) {

        const oldOverwrite =
            oldOverwrites.get(id);

        const newOverwrite =
            newOverwrites.get(id);

        const oldAllow =
            oldOverwrite?.allow?.bitfield ||
            0n;

        const oldDeny =
            oldOverwrite?.deny?.bitfield ||
            0n;

        const newAllow =
            newOverwrite?.allow?.bitfield ||
            0n;

        const newDeny =
            newOverwrite?.deny?.bitfield ||
            0n;

        if (
            oldAllow === newAllow &&
            oldDeny === newDeny
        ) {
            continue;
        }

        let targetName =
            id;

        if (
            id ===
            newChannel.guild.id
        ) {
            targetName = "@everyone";
        } else {

            const role =
                newChannel.guild.roles.cache.get(
                    id
                );

            if (role) {
                targetName =
                    role.name;
            }
        }

        const permissionParts = [];

        const permissions = [
            [
                "View Channel",
                PermissionFlagsBits.ViewChannel
            ],
            [
                "Send Messages",
                PermissionFlagsBits.SendMessages
            ],
            [
                "Read Message History",
                PermissionFlagsBits.ReadMessageHistory
            ],
            [
                "Manage Messages",
                PermissionFlagsBits.ManageMessages
            ],
            [
                "Manage Channel",
                PermissionFlagsBits.ManageChannels
            ],
            [
                "Connect",
                PermissionFlagsBits.Connect
            ],
            [
                "Speak",
                PermissionFlagsBits.Speak
            ]
        ];

        for (
            const [
                permissionName,
                permissionBit
            ]
            of permissions
        ) {

            const oldState =
                oldOverwrite
                    ? (
                        oldOverwrite.allow.has(permissionBit)
                            ? "on"
                            : oldOverwrite.deny.has(permissionBit)
                                ? "off"
                                : null
                    )
                    : null;

            const newState =
                newOverwrite
                    ? (
                        newOverwrite.allow.has(permissionBit)
                            ? "on"
                            : newOverwrite.deny.has(permissionBit)
                                ? "off"
                                : null
                    )
                    : null;

            if (
                oldState ===
                newState
            ) {
                continue;
            }

            permissionParts.push({
                target:
                    targetName,

                permission:
                    permissionName,

                old:
                    oldState,

                new:
                    newState
            });
        }

        if (
            permissionParts.length
        ) {
            changes.push(
                ...permissionParts
            );
        }
    }

    return changes;
}


async function handleChannelUpdate(
    oldChannel,
    newChannel
) {

    if (
        !newChannel.guild
    ) {
        return;
    }


    // --------------------------------------------------------
    // NAME CHANGE
    // --------------------------------------------------------

    if (
        oldChannel.name !==
        newChannel.name
    ) {

        const audit =
            await findAuditExecutor(
                newChannel.guild,
                AuditLogEvent.ChannelUpdate,
                newChannel.id,
                7000
            );

        const editor =
            audit?.executor;

        const embed =
            new EmbedBuilder()
                .setColor(0x808080)
                .setTitle(
                    "a channel have been edited"
                )
                .setDescription(
                    `new name ${channelMention(newChannel.id)}\n` +
                    `old name ${oldChannel.name}\n` +
                    `edited by ${editor ? userMention(editor.id) : "Unknown"}`
                )
                .setTimestamp();

        await sendLog(
            newChannel.guild,
            "channels",
            embed
        );
    }


    // --------------------------------------------------------
    // PERMISSION CHANGE
    // --------------------------------------------------------

    const permissionChanges =
        getPermissionChanges(
            oldChannel,
            newChannel
        );

    if (
        permissionChanges.length === 0
    ) {
        return;
    }

    const audit =
        await findAuditExecutor(
            newChannel.guild,
            AuditLogEvent.ChannelOverwriteUpdate,
            newChannel.id,
            7000
        ) ||
        await findAuditExecutor(
            newChannel.guild,
            AuditLogEvent.ChannelOverwriteCreate,
            newChannel.id,
            7000
        ) ||
        await findAuditExecutor(
            newChannel.guild,
            AuditLogEvent.ChannelOverwriteDelete,
            newChannel.id,
            7000
        ) ||
        await findAuditExecutor(
            newChannel.guild,
            AuditLogEvent.ChannelUpdate,
            newChannel.id,
            7000
        );

    const editor =
        audit?.executor;


    const newPermissions =
        permissionChanges
            .map(
                change =>
                    `${change.target} - ${change.permission} (${change.new || "default"})`
            )
            .join("\n");

    const oldPermissions =
        permissionChanges
            .filter(
                change =>
                    change.old &&
                    change.old !==
                    change.new
            )
            .map(
                change =>
                    `${change.target} - ${change.permission} (${change.old})`
            )
            .join("\n");


    let description =
        `new permissions\n${truncate(newPermissions, 900)}\n\n`;

    if (
        oldPermissions
    ) {
        description +=
            `old permissions\n${truncate(oldPermissions, 900)}\n\n`;
    }

    description +=
        `edited by ${editor ? userMention(editor.id) : "Unknown"}`;


    const embed =
        new EmbedBuilder()
            .setColor(0xffffff)
            .setTitle(
                "a channel have been edited"
            )
            .setDescription(
                description
            )
            .setTimestamp();

    await sendLog(
        newChannel.guild,
        "channels",
        embed
    );
}


// ============================================================
// COMMANDS
// ============================================================

const commands = [

    // --------------------------------------------------------
    // AUTO LOGS
    // --------------------------------------------------------

    new SlashCommandBuilder()
        .setName(
            "auto-logs"
        )
        .setDescription(
            "Create and configure Nexona server logs."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild.toString()
        )
        .addRoleOption(
            option =>
                option
                    .setName(
                        "role"
                    )
                    .setDescription(
                        "Role that can view the logs."
                    )
                    .setRequired(true)
        ),


    // --------------------------------------------------------
    // WARN
    // --------------------------------------------------------

    new SlashCommandBuilder()
        .setName(
            "warn"
        )
        .setDescription(
            "Warn a member."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addUserOption(
            option =>
                option
                    .setName(
                        "member"
                    )
                    .setDescription(
                        "Member to warn."
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
        ),


    // --------------------------------------------------------
    // WARNINGS
    // --------------------------------------------------------

    new SlashCommandBuilder()
        .setName(
            "warnings"
        )
        .setDescription(
            "View a member's warnings."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addUserOption(
            option =>
                option
                    .setName(
                        "member"
                    )
                    .setDescription(
                        "Member to inspect."
                    )
                    .setRequired(true)
        ),


    // --------------------------------------------------------
    // CLEAR WARNINGS
    // --------------------------------------------------------

    new SlashCommandBuilder()
        .setName(
            "warnings-clear"
        )
        .setDescription(
            "Clear all warnings from a member."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageMessages.toString()
        )
        .addUserOption(
            option =>
                option
                    .setName(
                        "member"
                    )
                    .setDescription(
                        "Member."
                    )
                    .setRequired(true)
        )
];


// ============================================================
// INSTALL
// ============================================================

function install(client) {

    if (
        client.__nexonaLogsInstalled
    ) {
        return;
    }

    client.__nexonaLogsInstalled =
        true;


    // ========================================================
    // MEMBER LEAVE
    // ========================================================

    client.on(
        "guildMemberRemove",
        async member => {

            try {

                // Kick gets its own log.
                const audit =
                    await findAuditExecutor(
                        member.guild,
                        AuditLogEvent.MemberKick,
                        member.id,
                        4000
                    );

                if (
                    audit
                ) {
                    await handleKick(
                        member
                    );

                    return;
                }

                await handleMemberRemove(
                    member
                );

            } catch (error) {

                console.error(
                    "NEXONA LEAVE LOG ERROR:",
                    error
                );
            }
        }
    );


    // ========================================================
    // BAN
    // ========================================================

    client.on(
        "guildBanAdd",
        async ban => {

            try {

                await handleBan(
                    ban
                );

            } catch (error) {

                console.error(
                    "NEXONA BAN LOG ERROR:",
                    error
                );
            }
        }
    );


    // ========================================================
    // REACTIONS
    // ========================================================

    client.on(
        "messageReactionAdd",
        async (
            reaction,
            user
        ) => {

            try {

                if (
                    reaction.partial
                ) {
                    await reaction.fetch()
                        .catch(() => {});
                }

                await handleReactionAdd(
                    reaction,
                    user
                );

            } catch (error) {

                console.error(
                    "NEXONA REACTION ADD LOG ERROR:",
                    error
                );
            }
        }
    );


    client.on(
        "messageReactionRemove",
        async (
            reaction,
            user
        ) => {

            try {

                if (
                    reaction.partial
                ) {
                    await reaction.fetch()
                        .catch(() => {});
                }

                await handleReactionRemove(
                    reaction,
                    user
                );

            } catch (error) {

                console.error(
                    "NEXONA REACTION REMOVE LOG ERROR:",
                    error
                );
            }
        }
    );


    // ========================================================
    // MESSAGE CACHE
    // ========================================================

    client.on(
        "messageCreate",
        handleMessageCreate
    );


    // ========================================================
    // MESSAGE DELETE
    // ========================================================

    client.on(
        "messageDelete",
        async message => {

            try {

                await handleMessageDelete(
                    message
                );

            } catch (error) {

                console.error(
                    "NEXONA MESSAGE DELETE LOG ERROR:",
                    error
                );
            }
        }
    );


    // ========================================================
    // MESSAGE UPDATE
    // ========================================================

    client.on(
        "messageUpdate",
        async (
            oldMessage,
            newMessage
        ) => {

            try {

                await handleMessageUpdate(
                    oldMessage,
                    newMessage
                );

            } catch (error) {

                console.error(
                    "NEXONA MESSAGE EDIT LOG ERROR:",
                    error
                );
            }
        }
    );


    // ========================================================
    // CHANNEL CREATE
    // ========================================================

    client.on(
        "channelCreate",
        async channel => {

            try {

                await handleChannelCreate(
                    channel
                );

            } catch (error) {

                console.error(
                    "NEXONA CHANNEL CREATE LOG ERROR:",
                    error
                );
            }
        }
    );


    // ========================================================
    // CHANNEL DELETE
    // ========================================================

    client.on(
        "channelDelete",
        async channel => {

            try {

                await handleChannelDelete(
                    channel
                );

            } catch (error) {

                console.error(
                    "NEXONA CHANNEL DELETE LOG ERROR:",
                    error
                );
            }
        }
    );


    // ========================================================
    // CHANNEL UPDATE
    // ========================================================

    client.on(
        "channelUpdate",
        async (
            oldChannel,
            newChannel
        ) => {

            try {

                await handleChannelUpdate(
                    oldChannel,
                    newChannel
                );

            } catch (error) {

                console.error(
                    "NEXONA CHANNEL UPDATE LOG ERROR:",
                    error
                );
            }
        }
    );


    // ========================================================
    // COMMANDS
    // ========================================================

    client.on(
        "interactionCreate",
        async interaction => {

            try {

                if (
                    !interaction.isChatInputCommand()
                ) {
                    return;
                }

                if (
                    !interaction.guild
                ) {
                    return;
                }


                // =================================================
                // AUTO LOGS
                // =================================================

                if (
                    interaction.commandName ===
                    "auto-logs"
                ) {

                    if (
                        !interaction.memberPermissions?.has(
                            PermissionFlagsBits.ManageGuild
                        )
                    ) {
                        return interaction.reply({
                            content:
                                "You need Manage Server to use this command.",
                            ephemeral: true
                        });
                    }

                    const role =
                        interaction.options.getRole(
                            "role"
                        );

                    await interaction.deferReply({
                        ephemeral: true
                    });

                    const result =
                        await createLogs(
                            interaction.guild,
                            role
                        );

                    return interaction.editReply({
                        content:
                            `Nexona logs have been created successfully.\n\n` +
                            `Category: ${result.category}\n` +
                            `Log role: ${role}`
                    });
                }


                // =================================================
                // WARN
                // =================================================

                if (
                    interaction.commandName ===
                    "warn"
                ) {

                    if (
                        !interaction.memberPermissions?.has(
                            PermissionFlagsBits.ManageMessages
                        )
                    ) {
                        return interaction.reply({
                            content:
                                "You need Manage Messages to use this command.",
                            ephemeral: true
                        });
                    }

                    const user =
                        interaction.options.getUser(
                            "member"
                        );

                    const reason =
                        interaction.options.getString(
                            "reason"
                        );

                    const member =
                        await interaction.guild.members
                            .fetch(
                                user.id
                            )
                            .catch(() => null);

                    if (!member) {
                        return interaction.reply({
                            content:
                                "That member is not in this server.",
                            ephemeral: true
                        });
                    }

                    if (
                        member.id ===
                        interaction.user.id
                    ) {
                        return interaction.reply({
                            content:
                                "You cannot warn yourself.",
                            ephemeral: true
                        });
                    }

                    const count =
                        await warnMember(
                            interaction.guild,
                            member,
                            interaction.user,
                            reason
                        );

                    return interaction.reply({
                        content:
                            `${member.user.tag} has been warned. They now have ${count} warning${count === 1 ? "" : "s"}.`,
                        ephemeral: true
                    });
                }


                // =================================================
                // WARNINGS
                // =================================================

                if (
                    interaction.commandName ===
                    "warnings"
                ) {

                    const user =
                        interaction.options.getUser(
                            "member"
                        );

                    const guildWarnings =
                        getGuildWarnings(
                            interaction.guild.id
                        );

                    const warnings =
                        guildWarnings[user.id] ||
                        [];

                    if (
                        warnings.length === 0
                    ) {
                        return interaction.reply({
                            content:
                                `${userMention(user.id)} has no warnings.`,
                            ephemeral: true
                        });
                    }

                    const description =
                        warnings
                            .map(
                                (warning, index) =>
                                    `**#${index + 1}** • ${truncate(warning.reason, 500)}\n` +
                                    `Staff: ${userMention(warning.staffId)}\n` +
                                    `<t:${Math.floor(warning.timestamp / 1000)}:R>`
                            )
                            .join("\n\n");

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    `Warnings for ${user.username}`
                                )
                                .setDescription(
                                    description
                                )
                                .setFooter({
                                    text:
                                        `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
                                })
                                .setTimestamp()
                        ],
                        ephemeral: true
                    });
                }


                // =================================================
                // CLEAR WARNINGS
                // =================================================

                if (
                    interaction.commandName ===
                    "warnings-clear"
                ) {

                    const user =
                        interaction.options.getUser(
                            "member"
                        );

                    const guildWarnings =
                        getGuildWarnings(
                            interaction.guild.id
                        );

                    const oldCount =
                        guildWarnings[user.id]
                            ?.length ||
                        0;

                    delete guildWarnings[
                        user.id
                    ];

                    saveJSON(
                        WARNINGS_DATA_FILE,
                        warningsDatabase
                    );

                    return interaction.reply({
                        content:
                            `Cleared ${oldCount} warning${oldCount === 1 ? "" : "s"} from ${userMention(user.id)}.`,
                        ephemeral: true
                    });
                }

            } catch (error) {

                console.error(
                    "NEXONA LOG COMMAND ERROR:",
                    error
                );

                if (
                    !interaction.replied &&
                    !interaction.deferred
                ) {
                    await interaction.reply({
                        content:
                            "Nexona encountered an error while processing this command.",
                        ephemeral: true
                    }).catch(() => {});
                }
            }
        }
    );


    console.log(
        "Nexona Logs system loaded."
    );
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
    commands,
    install,
    createLogs,
    warnMember,
    markAutoModDeleted
};