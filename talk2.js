const {
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");

const OWNER_ID = "1486246219243323503";

const command = new SlashCommandBuilder()
    .setName("sectalk")
    .setDescription("خل مامبو ترسل رسالة في أي سيرفر هي موجودة فيه")
    .addStringOption(option =>
        option
            .setName("server_id")
            .setDescription("معرّف السيرفر الهدف")
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName("channel_id")
            .setDescription("معرّف القناة الهدف")
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName("text")
            .setDescription("الرسالة اللي تبي مامبو ترسلها")
            .setRequired(true)
            .setMaxLength(2000)
    );

async function handleInteraction(interaction, client) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== "sectalk"
    ) {
        return false;
    }

    // Owner only
    if (interaction.user.id !== OWNER_ID) {
        await interaction.reply({
            content: "هذا الأمر مخصص لأونر مامبو فقط.",
            ephemeral: true
        });

        return true;
    }

    // Acknowledge immediately to prevent
    // "Application did not respond"
    await interaction.deferReply({
        ephemeral: true
    });

    try {
        const serverId = interaction.options.getString(
            "server_id",
            true
        ).trim();

        const channelId = interaction.options.getString(
            "channel_id",
            true
        ).trim();

        const text = interaction.options.getString(
            "text",
            true
        );

        if (!/^\d{17,20}$/.test(serverId)) {
            await interaction.editReply(
                "معرّف السيرفر غير صحيح."
            );
            return true;
        }

        if (!/^\d{17,20}$/.test(channelId)) {
            await interaction.editReply(
                "معرّف القناة غير صحيح."
            );
            return true;
        }

        // Fetch the target server
        const guild = await client.guilds.fetch(serverId)
            .catch(() => null);

        if (!guild) {
            await interaction.editReply(
                "ما لقيت السيرفر. تأكد أن مامبو موجودة فيه وأن المعرّف صحيح."
            );
            return true;
        }

        // Fetch the target channel
        const channel = await guild.channels.fetch(channelId)
            .catch(() => null);

        if (!channel) {
            await interaction.editReply(
                "ما لقيت القناة داخل السيرفر المحدد."
            );
            return true;
        }

        if (
            channel.type !== ChannelType.GuildText &&
            channel.type !== ChannelType.GuildAnnouncement
        ) {
            await interaction.editReply(
                "القناة الهدف لازم تكون قناة نصية."
            );
            return true;
        }

        const botMember = await guild.members.fetchMe();

        const permissions = channel.permissionsFor(botMember);

        if (
            !permissions ||
            !permissions.has(PermissionFlagsBits.ViewChannel) ||
            !permissions.has(PermissionFlagsBits.SendMessages)
        ) {
            await interaction.editReply(
                "مامبو ما عندها صلاحية مشاهدة القناة وإرسال الرسائل فيها."
            );
            return true;
        }

        // Send as a normal bot message
        await channel.send({
            content: text,
            allowedMentions: {
                parse: []
            }
        });

        await interaction.editReply(
            `تم إرسال رسالة مامبو بنجاح إلى السيرفر **${guild.name}** والقناة **#${channel.name}**.`
        );

    } catch (error) {
        console.error("Sectalk error:", error);

        await interaction.editReply(
            "فشل إرسال الرسالة. راجع سجل التشغيل لمعرفة السبب."
        ).catch(() => {});
    }

    return true;
}

module.exports = {
    commands: [command],
    handleInteraction
};