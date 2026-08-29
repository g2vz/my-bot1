const fs = require("fs");
const path = require("path");

// ============================================================
// NEXONA AUTOMOD MESSAGE DELETE
// ============================================================

const OWNER_ID = "1193602200644091957";

const DATA_FILE = path.join(
    __dirname,
    "automod.json"
);


// ============================================================
// LOAD DATABASE
// ============================================================

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        return {};
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
            "NEXONA AUTOMOD DELETE: Could not read automod.json",
            error
        );

        return {};
    }
}


// ============================================================
// NORMALIZE TEXT
// ============================================================

function normalizeText(text) {
    return String(text || "")
        .toLowerCase()
        .normalize("NFKC");
}


// ============================================================
// CHECK BLOCKED WORD
// ============================================================

function findBlockedWord(
    content,
    words
) {
    const normalizedContent =
        normalizeText(content);

    for (
        const word
        of Object.keys(words || {})
    ) {

        const normalizedWord =
            normalizeText(word)
                .trim();

        if (!normalizedWord) {
            continue;
        }

        if (
            normalizedContent.includes(
                normalizedWord
            )
        ) {
            return word;
        }
    }

    return null;
}


// ============================================================
// DELETE MESSAGE
// ============================================================

async function deleteBlockedMessage(
    message,
    blockedWord
) {
    try {

        if (
            !message.deletable
        ) {
            console.warn(
                `[Nexona AutoMod] Cannot delete message in #${message.channel?.name || "unknown channel"}`
            );

            return false;
        }

        await message.delete();

        console.log(
            `[Nexona AutoMod] Deleted blocked message from ${message.author.tag} | Word: ${blockedWord}`
        );

        return true;

    } catch (error) {

        console.error(
            "[NEXONA AUTOMOD DELETE ERROR]",
            error
        );

        return false;
    }
}


// ============================================================
// INSTALL
// ============================================================

function install(client) {

    // Prevent installing this listener more than once.
    if (
        client.__nexonaAutomodDeleteInstalled
    ) {
        return;
    }

    client.__nexonaAutomodDeleteInstalled =
        true;


    client.on(
        "messageCreate",
        async message => {

            try {

                // =================================================
                // BASIC CHECKS
                // =================================================

                if (
                    !message.guild
                ) {
                    return;
                }

                // Ignore bots.
                if (
                    message.author.bot
                ) {
                    return;
                }

                // Owner bypass.
                if (
                    message.author.id ===
                    OWNER_ID
                ) {
                    return;
                }


                // =================================================
                // GET MESSAGE CONTENT
                // =================================================

                const content =
                    message.content;

                if (
                    !content ||
                    !content.trim()
                ) {
                    return;
                }


                // =================================================
                // LOAD AUTOMOD DATABASE
                // =================================================

                const database =
                    loadData();

                const guildData =
                    database[
                        message.guild.id
                    ];

                if (
                    !guildData
                ) {
                    return;
                }


                // =================================================
                // GET BLOCKED WORDS
                // =================================================

                const words =
                    guildData.words;

                if (
                    !words ||
                    Object.keys(words).length === 0
                ) {
                    return;
                }


                // =================================================
                // FIND BLOCKED WORD
                // =================================================

                const blockedWord =
                    findBlockedWord(
                        content,
                        words
                    );

                if (
                    !blockedWord
                ) {
                    return;
                }


                // =================================================
                // DELETE IMMEDIATELY
                // =================================================

                await deleteBlockedMessage(
                    message,
                    blockedWord
                );

            } catch (error) {

                console.error(
                    "NEXONA AUTOMOD DELETE LISTENER ERROR:",
                    error
                );

            }

        }
    );


    console.log(
        "Nexona AutoMod message deletion system loaded."
    );
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
    install
};