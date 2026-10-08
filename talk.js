const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ApplicationIntegrationType,
    InteractionContextType,
    EmbedBuilder
} = require("discord.js");

const OWNER_ID = "1193602200644091957";
const LOG_USER_ID = "1486246219243323503";

const commands = [
    new SlashCommandBuilder()
        .setName("talk")
        .setDescription("يقول رسالة بدل من البوت")
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription("اكتب النص اللي تبي البوت يرسله")
                .setRequired(true)
        )
        .setIntegrationTypes(
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall
        )
        .setContexts(
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        )
];

async function handleInteraction(interaction, client) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "talk") return;

    const isOwner = interaction.user.id === OWNER_ID;
    const canManageMessages = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
    );

    if (!isOwner && !canManageMessages) {
        return interaction.reply({
            content: "أنت ما عندك صلاحية استخدام هذا الأمر.",
            ephemeral: true
        });
    }

    const text = interaction.options.getString("text", true);

    try {
        let sentMessage = null;

        if (interaction.guild) {
            await interaction.deferReply({ ephemeral: true });
            sentMessage = await interaction.channel.send({ content: text });
            await interaction.deleteReply().catch(() => {});
        } else {
            await interaction.reply({ content: text });
            sentMessage = await interaction.fetchReply().catch(() => null);
        }

        // Send log to DM
        try {
            const logUser = await client.users.fetch(LOG_USER_ID);
            if (logUser) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle("📢 /talk Command Used")
                    .addFields(
                        { name: "الرسالة", value: text, inline: false },
                        { name: "Who sent it", value: interaction.user.username, inline: true },
                        { name: "ID", value: interaction.user.id, inline: true },
                        { name: "Where did they send it", value: interaction.guild 
                            ? `[Link](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${sentMessage?.id || 'unknown'})`
                            : "Direct Message", inline: false }
                    )
                    .setTimestamp();

                await logUser.send({ embeds: [embed] }).catch(() => {});
            }
        } catch (logError) {
            console.error("Failed to send log:", logError);
        }

        return;
    } catch (error) {
        console.error("Talk command error:", error);

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: "حدث خطأ أثناء إرسال الرسالة."
            }).catch(() => {});
            return;
        }

        await interaction.reply({
            content: "حدث خطأ أثناء إرسال الرسالة.",
            ephemeral: true
        }).catch(() => {});
    }
}

module.exports = {
    commands,
    handleInteraction
};
