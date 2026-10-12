const { SlashCommandBuilder } = require("discord.js");

const OWNER_ID = "1486246219243323503";

const command = new SlashCommandBuilder()
    .setName("talk")
    .setDescription("خل مامبو ترسل رسالة")
    .addStringOption(option =>
        option
            .setName("text")
            .setDescription("الرسالة اللي تبي مامبو ترسلها")
            .setRequired(true)
            .setMaxLength(2000)
    );

async function handleInteraction(interaction) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== "talk"
    ) {
        return false;
    }

    if (interaction.user.id !== OWNER_ID) {
        await interaction.reply({
            content: "هذا الأمر مخصص لأونر البوت فقط.",
            ephemeral: true
        });
        return true;
    }

    const text = interaction.options.getString("text", true);

    await interaction.deferReply({ ephemeral: true });

    try {
        if (!interaction.channel?.isTextBased()) {
            await interaction.editReply(
                "ما أقدر أرسل رسالة في هذي القناة."
            );
            return true;
        }

        await interaction.channel.send({
            content: text,
            allowedMentions: { parse: [] }
        });

        await interaction.editReply(
            "تم إرسال الرسالة باسم مامبو."
        );
    } catch (error) {
        console.error("Mambo talk error:", error);

        await interaction.editReply(
            "فشل إرسال الرسالة. تأكد من صلاحيات مامبو."
        );
    }

    return true;
}

module.exports = {
    commands: [command],
    handleInteraction
};