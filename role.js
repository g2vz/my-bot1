const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js");

const BOT_OWNER_ID = "1486246219243323503";

const commands = [
    new SlashCommandBuilder()
        .setName("role")
        .setDescription("عط عبد رتبة")
        .addUserOption(option =>
            option
                .setName("member")
                .setDescription("مين تبي تعطية رتبه؟")
                .setRequired(true)
        )
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("اي رتبة تبي تعطيه حضرة جنابك")
                .setRequired(true)
        )
        .toJSON(),
];

async function handleInteraction(interaction) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== "role"
    ) {
        return false;
    }

    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "هذا الأمر يعمل داخل السيرفر فقط.",
            ephemeral: true,
        });
        return true;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const guild = interaction.guild;
        const targetUser = interaction.options.getUser("member");
        const role = interaction.options.getRole("role");

        const isGuildOwner = interaction.user.id === guild.ownerId;
        const isBotOwner = interaction.user.id === BOT_OWNER_ID;
        const isPrivilegedOwner = isGuildOwner || isBotOwner;

        const actor = await guild.members.fetch(interaction.user.id);
        const target = await guild.members.fetch(targetUser.id);
        const botMember = await guild.members.fetchMe();

        const hasPermission =
            actor.permissions.has(PermissionFlagsBits.Administrator) ||
            actor.permissions.has(PermissionFlagsBits.ManageRoles);

        if (!isPrivilegedOwner && !hasPermission) {
            await interaction.editReply(
                "ما عندك صلاحية استخدام الأمر. تحتاج Administrator أو Manage Roles."
            );
            return true;
        }

        if (role.id === guild.id || role.managed) {
            await interaction.editReply(
                "ما أقدر أعطي رتبة @everyone أو رتبة يديرها بوت أو تكامل."
            );
            return true;
        }

        if (!isPrivilegedOwner && role.position >= actor.roles.highest.position) {
            await interaction.editReply(
                "ما تقدر تعطي رتبة أعلى من رتبتك أو مساوية لها."
            );
            return true;
        }

        if (role.position >= botMember.roles.highest.position) {
            await interaction.editReply(
                "رتبة مامبو لازم تكون أعلى من الرتبة المطلوبة. ارفع رتبة البوت من إعدادات السيرفر."
            );
            return true;
        }

        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await interaction.editReply(
                "مامبو ما عندها صلاحية Manage Roles."
            );
            return true;
        }

        if (target.roles.cache.has(role.id)) {
            await interaction.editReply(
                `${target} عنده الرتبة ${role} بالفعل.`
            );
            return true;
        }

        await target.roles.add(
            role,
            `Role command used by ${interaction.user.tag}`
        );

        await interaction.editReply(
            `تم إعطاء ${role} إلى ${target} بنجاح.`
        );

    } catch (error) {
        console.error("Role command error:", error);

        await interaction.editReply(
            "فشل إعطاء الرتبة. تأكد من صلاحيات مامبو وترتيب الرتب."
        ).catch(() => {});
    }

    return true;
}

module.exports = {
    commands,
    handleInteraction,
};