
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const BOT_OWNER_ID = "1486246219243323503";

const commands = [
  new SlashCommandBuilder()
    .setName("role")
    .setDescription("إعطاء رتبة لعضو")
    .addUserOption(option =>
      option
        .setName("member")
        .setDescription("العضو الذي تريد إعطاءه الرتبة")
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("الرتبة التي تريد إعطاءها")
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

  const guild = interaction.guild;
  const actor = interaction.member;
  const targetUser = interaction.options.getUser("member");
  const role = interaction.options.getRole("role");

  const isGuildOwner = interaction.user.id === guild.ownerId;
  const isBotOwner = interaction.user.id === BOT_OWNER_ID;
  const isPrivilegedOwner = isGuildOwner || isBotOwner;

  const hasPermission =
    actor.permissions.has(PermissionFlagsBits.Administrator) ||
    actor.permissions.has(PermissionFlagsBits.ManageRoles);

  if (!isPrivilegedOwner && !hasPermission) {
    await interaction.reply({
      content: "ما عندك صلاحية استخدام هذا الأمر. تحتاج Administrator أو Manage Roles.",
      ephemeral: true,
    });
    return true;
  }

  const target = await guild.members.fetch(targetUser.id).catch(() => null);
  const botMember = await guild.members.fetchMe();

  if (!target) {
    await interaction.reply({
      content: "ما قدرت ألقى العضو داخل السيرفر.",
      ephemeral: true,
    });
    return true;
  }

  if (role.id === guild.id || role.managed) {
    await interaction.reply({
      content: "ما أقدر أعطي رتبة @everyone أو رتبة يديرها بوت أو تكامل.",
      ephemeral: true,
    });
    return true;
  }

  // الأعضاء العاديون لا يستطيعون إعطاء رتبة أعلى من رتبتهم أو مساوية لها.
  if (!isPrivilegedOwner) {
    const actorHighestRole = interaction.guild.members.me
      ? actor.roles.highest
      : null;

    if (!actorHighestRole || role.position >= actorHighestRole.position) {
      await interaction.reply({
        content: "ما تقدر تعطي رتبة أعلى من رتبتك أو مساوية لها.",
        ephemeral: true,
      });
      return true;
    }
  }

  // حتى أونر السيرفر وأونر البوت لا يستطيعان تجاوز ترتيب رتب البوت نفسه.
  if (role.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content: "رتبة البوت لازم تكون أعلى من الرتبة اللي تبي تعطيها. ارفع رتبة مامبو من إعدادات السيرفر.",
      ephemeral: true,
    });
    return true;
  }

  if (target.roles.cache.has(role.id)) {
    await interaction.reply({
      content: `${target} عنده الرتبة ${role} بالفعل.`,
      ephemeral: true,
    });
    return true;
  }

  try {
    await target.roles.add(
      role,
      `Role command used by ${interaction.user.tag}`
    );

    await interaction.reply({
      content: `تم إعطاء ${role} إلى ${target} بنجاح.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error("Role command error:", error);

    await interaction.reply({
      content: "فشل إعطاء الرتبة. تأكد من صلاحيات مامبو وترتيب الرتب.",
      ephemeral: true,
    });
  }

  return true;
}

module.exports = {
  commands,
  handleInteraction,
};
