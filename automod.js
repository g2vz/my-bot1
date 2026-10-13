
const {
  PermissionFlagsBits,
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

// ==========================================
// إعدادات النظام
// ==========================================

const OWNER_ID = "1486246219243323503";

// الكلمات العادية: اكتب كلماتك داخل القائمة
const NORMAL_WORDS = [كسمك];

// الكلمات الخاصة: اكتب كلماتك داخل القائمة
const SPECIAL_WORDS = [
  // "اكتب الكلمة الخاصة هنا",
];

// العقوبات
const NORMAL_TIMEOUTS = [
  5 * 60 * 1000,   // أول مرة: 5 دقائق
  10 * 60 * 1000,  // ثاني مرة: 10 دقائق
  25 * 60 * 1000,  // ثالث مرة وما بعدها: 25 دقيقة
];

const SPECIAL_FIRST_TIMEOUT = 10 * 60 * 1000;
const SPECIAL_REPEAT_TIMEOUT = 10 * 60 * 1000;

// مدة التايم القصوى في Discord هي 28 يومًا
const DATA_FILE = path.join(__dirname, "automod-data.json");

// صلاحيات الإشراف التي نعتبرها صلاحيات Moderation
const MODERATION_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
];

// ==========================================
// حفظ المخالفات حتى بعد إعادة تشغيل البوت
// ==========================================

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, "{}");
    }

    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("AutoMod: تعذر قراءة ملف البيانات:", error);
    return {};
  }
}

let data = loadData();

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("AutoMod: تعذر حفظ المخالفات:", error);
  }
}

function getViolationCount(guildId, userId, type, word) {
  const key = `${guildId}:${userId}:${type}:${word}`;
  return Number(data[key] || 0);
}

function addViolation(guildId, userId, type, word) {
  const key = `${guildId}:${userId}:${type}:${word}`;
  data[key] = Number(data[key] || 0) + 1;
  saveData();
  return data[key];
}

// ==========================================
// اكتشاف الكلمات
// ==========================================

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .trim();
}

function findMatchedWord(content, words) {
  const normalizedContent = normalize(content);

  return words.find((word) => {
    const normalizedWord = normalize(word);
    return normalizedWord.length > 0 &&
      normalizedContent.includes(normalizedWord);
  }) || null;
}

// ==========================================
// التحقق من صلاحيات الإشراف
// ==========================================

function hasModerationPermissions(member) {
  return MODERATION_PERMISSIONS.some((permission) =>
    member.permissions.has(permission)
  );
}

// إزالة الرتب التي تمنح صلاحيات إشراف.
// ملاحظة: إزالة رتبة قد تزيل معها صلاحيات أخرى موجودة في الرتبة نفسها.
async function removeModerationRoles(member) {
  const rolesToRemove = member.roles.cache.filter((role) => {
    if (role.id === member.guild.id) return false;
    if (role.managed) return false;

    return MODERATION_PERMISSIONS.some((permission) =>
      role.permissions.has(permission)
    );
  });

  if (rolesToRemove.size === 0) {
    return {
      removed: false,
      reason: "no-removable-moderation-roles",
    };
  }

  await member.roles.remove(
    rolesToRemove,
    "AutoMod: استخدام كلمة خاصة"
  );

  return { removed: true };
}

// ==========================================
// التايم
// ==========================================

async function applyTimeout(member, duration, reason) {
  if (!member.moderatable) {
    console.warn(
      `AutoMod: لا أستطيع إعطاء تايم لـ ${member.user.tag}. تحقق من صلاحيات البوت وترتيب الرتب.`
    );
    return false;
  }

  await member.timeout(duration, reason);
  return true;
}

// ==========================================
// معالجة الكلمات العادية
// ==========================================

async function handleNormalWord(message, word) {
  const count = addViolation(
    message.guild.id,
    message.author.id,
    "normal",
    normalize(word)
  );

  const index = Math.min(count - 1, NORMAL_TIMEOUTS.length - 1);
  const duration = NORMAL_TIMEOUTS[index];

  await applyTimeout(
    message.member,
    duration,
    `AutoMod: مخالفة كلمة عادية (المرة ${count})`
  ).catch((error) => {
    console.error("AutoMod: فشل تطبيق التايم:", error);
  });

  console.log(
    `AutoMod: حذف رسالة ${message.author.tag} بسبب كلمة عادية. المخالفة رقم ${count}.`
  );
}

// ==========================================
// معالجة الكلمات الخاصة
// ==========================================

async function handleSpecialWord(message, word) {
  const member = message.member;

  const count = addViolation(
    message.guild.id,
    message.author.id,
    "special",
    normalize(word)
  );

  // إذا كان عنده صلاحيات إشراف
  if (hasModerationPermissions(member)) {
    try {
      const result = await removeModerationRoles(member);

      await applyTimeout(
        member,
        SPECIAL_FIRST_TIMEOUT,
        "AutoMod: استخدام كلمة خاصة"
      );

      try {
        await message.author.send(
          `تم إزالة صلاحياتك، ${message.author}.\n\n` +
          `بسبب قولك "${word}"، وهي أولاً مخالفة دينية وثانياً مخالفة لقوانين السيرفر.\n\n` +
          `شكراً لك.`
        );
      } catch {
        console.warn(
          `AutoMod: لم أستطع إرسال رسالة خاصة إلى ${message.author.tag}. قد تكون الرسائل الخاصة مغلقة.`
        );
      }

      if (!result.removed) {
        console.warn(
          `AutoMod: لم أجد رتبة قابلة للإزالة تمنح صلاحيات إشراف لـ ${message.author.tag}.`
        );
      }
    } catch (error) {
      console.error(
        "AutoMod: فشل تطبيق عقوبة الكلمة الخاصة على المشرف:",
        error
      );
    }

    return;
  }

  // العضو العادي: أول مرة تايم، وثاني مرة كيك
  if (count === 1) {
    await applyTimeout(
      member,
      SPECIAL_FIRST_TIMEOUT,
      "AutoMod: أول مخالفة لكلمة خاصة"
    ).catch((error) => {
      console.error("AutoMod: فشل التايم:", error);
    });

    return;
  }

  // من المرة الثانية وما بعدها، يحاول البوت طرد العضو
  if (!member.kickable) {
    console.warn(
      `AutoMod: لا أستطيع طرد ${message.author.tag}. تحقق من صلاحيات البوت وترتيب الرتب.`
    );
    return;
  }

  await member.kick("AutoMod: تكرار استخدام كلمة خاصة").catch((error) => {
    console.error("AutoMod: فشل طرد العضو:", error);
  });
}

// ==========================================
// مستمع الرسائل
// ==========================================

async function handleMessage(message) {
  try {
    if (!message.guild || !message.member) return;
    if (message.author.bot) return;

    // الأونر مستثنى بالكامل
    if (message.author.id === OWNER_ID) return;

    const content = message.content;
    if (!content) return;

    // الكلمات الخاصة لها الأولوية
    const specialWord = findMatchedWord(content, SPECIAL_WORDS);

    if (specialWord) {
      await message.delete().catch(() => {});
      await handleSpecialWord(message, specialWord);
      return;
    }

    // الكلمات العادية
    const normalWord = findMatchedWord(content, NORMAL_WORDS);

    if (normalWord) {
      await message.delete().catch(() => {});
      await handleNormalWord(message, normalWord);
    }
  } catch (error) {
    console.error("AutoMod: خطأ أثناء فحص رسالة:", error);
  }
}

module.exports = {
  handleMessage,
};
