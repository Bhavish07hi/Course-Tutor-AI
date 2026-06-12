console.log("COURSE TUTOR AI v1.0");
const chatBox = document.getElementById("chatBox");
const questionInput = document.getElementById("question");
const askBtn = document.getElementById("askBtn");
const uploadInput = document.getElementById("pdfFile");
const searchInput = document.getElementById("searchChats");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const exportBtn = document.getElementById("exportChatBtn");

let sessions = [];
let currentSession = null;
let activeSearchTerm = "";
let currentTheme = localStorage.getItem("theme") || "dark";

// ==========================================================================
// 1. Data Persistence (LocalStorage Engine)
// ==========================================================================
function saveSessions() {
    localStorage.setItem("courseTutorSessions", JSON.stringify(sessions));
    if (currentSession) {
        localStorage.setItem("activeSessionId", String(currentSession.id));
    }
}

function loadSessionsFromStorage() {
    const saved = localStorage.getItem("courseTutorSessions");
    if (!saved) return false;

    try {
        sessions = JSON.parse(saved);
        
        sessions.forEach(session => {
            if (session.pinned === undefined) {
                session.pinned = false;
            }
        });

        if (sessions.length > 0) {
            const activeId = localStorage.getItem("activeSessionId");
            currentSession = sessions.find(s => String(s.id) === activeId) || sessions[sessions.length - 1];
            return true;
        }
    } catch (error) {
        console.error("Storage load error:", error);
    }
    return false;
}

// ==========================================================================
// 2. UI Rendering Helpers
// ==========================================================================
function addMessage(message, className) {
    const div = document.createElement("div");
    div.className = className === "user" ? "user-message" : "bot-message";
    div.innerHTML = highlightText(message);

    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
}

// ==========================================================================
// 3. Multi-Session Core Architecture
// ==========================================================================
function createNewSession() {
    currentSession = {
        id: Date.now() + Math.random(),
        title: "New Chat",
        messages: [],
        pinned: false
    };
    sessions.push(currentSession);
    saveSessions();
}

function renderSessions() {
    const historyList = document.getElementById("historyList");
    if (!historyList) return;

    historyList.innerHTML = "";
    const searchText = searchInput?.value.toLowerCase().trim() || "";

    const filteredSessions = sessions.filter(session => {
        if (!searchText) return true;

        const titleMatch = (session.title || "").toLowerCase().includes(searchText);
        const contentMatch = session.messages.some(msg => {
            const searchableText = `
                ${msg.text || ""}
                ${msg.answer || ""}
                ${msg.source || ""}
                ${msg.sourceFile || ""}
            `.toLowerCase();
            return searchableText.includes(searchText);
        });

        return titleMatch || contentMatch;
    });

    if (filteredSessions.length === 0) {
        historyList.innerHTML = `
            <div style="color:#9ca3af; text-align:center; padding:12px; font-size:14px;">
                No chats found
            </div>
        `;
        return;
    }

    filteredSessions
        .slice()
        .sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return b.id - a.id;
        })
        .forEach(session => {
            let previewText = "";

            if (searchText) {
                const matchingMessage = session.messages.find(msg => {
                    const searchableText = `
                        ${msg.text || ""}
                        ${msg.answer || ""}
                        ${msg.source || ""}
                        ${msg.sourceFile || ""}
                    `.toLowerCase();
                    return searchableText.includes(searchText);
                });

                if (matchingMessage) {
                    previewText = matchingMessage.answer || matchingMessage.text || "";
                    const index = previewText.toLowerCase().indexOf(searchText);

                    if (index !== -1) {
                        const start = Math.max(0, index - 25);
                        const end = Math.min(previewText.length, index + searchText.length + 25);
                        previewText = "..." + previewText.substring(start, end) + "...";
                        previewText = previewText.replace(
                            new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
                            match => `<mark>${match}</mark>`
                        );
                    }
                }
            }

            const div = document.createElement("div");
            div.className = "history-item";
            if (currentSession && currentSession.id === session.id) {
                div.classList.add("active");
            }

            const titleWrapper = document.createElement("div");
            titleWrapper.style.flex = "1";
            titleWrapper.style.minWidth = "0";

            const titleSpan = document.createElement("span");
            titleSpan.textContent = session.pinned ? `📌 ${session.title}` : session.title;
            titleWrapper.appendChild(titleSpan);

            if (previewText) {
                const previewDiv = document.createElement("div");
                previewDiv.className = "search-preview";
                previewDiv.innerHTML = previewText;
                titleWrapper.appendChild(previewDiv);
            }

            const menuBtn = document.createElement("button");
            menuBtn.className = "menu-btn";
            menuBtn.innerHTML = "⋯";

            const menu = document.createElement("div");
            menu.className = "session-menu";

            const pinOption = document.createElement("div");
            pinOption.className = "menu-item";
            pinOption.textContent = session.pinned ? "Unpin" : "Pin";

            const renameOption = document.createElement("div");
            renameOption.className = "menu-item";
            renameOption.textContent = "Rename";

            const deleteOption = document.createElement("div");
            deleteOption.className = "menu-item delete-option";
            deleteOption.textContent = "Delete";

            menu.appendChild(pinOption);
            menu.appendChild(renameOption);
            menu.appendChild(deleteOption);

            menuBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                document.querySelectorAll(".session-menu").forEach(m => {
                    if (m !== menu) m.style.display = "none";
                });
                menu.style.display = menu.style.display === "block" ? "none" : "block";
                menuBtn.blur();
            });

            pinOption.addEventListener("click", (e) => {
                e.stopPropagation();
                session.pinned = !session.pinned;
                saveSessions();
                renderSessions();
            });

            deleteOption.addEventListener("click", (e) => {
                e.stopPropagation();
                deleteSession(session.id);
            });

            renameOption.addEventListener("click", (e) => {
                e.stopPropagation();
                menu.style.display = "none";

                const input = document.createElement("input");
                input.className = "rename-input";
                input.value = session.title;
                div.replaceChild(input, titleWrapper);
                input.focus();
                input.select();

                function saveRename() {
                    const newTitle = input.value.trim();
                    session.title = newTitle || "New Chat";
                    saveSessions();
                    renderSessions();
                }

                input.addEventListener("blur", saveRename);
                input.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") saveRename();
                    if (event.key === "Escape") renderSessions();
                });
            });

            div.appendChild(titleWrapper);
            div.appendChild(menuBtn);
            div.appendChild(menu);

            div.addEventListener("click", () => {
                loadSession(session.id);
                setTimeout(() => {
                    scrollToSearchMatch();
                }, 100);
            });

            historyList.appendChild(div);
        });
}

function scrollToSearchMatch() {
    const highlighted = document.querySelector(".chat-highlight");
    if (!highlighted) return;

    highlighted.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

    highlighted.classList.add("search-highlight-active");

    setTimeout(() => {
        highlighted.classList.remove("search-highlight-active");
    }, 2000);
}

// ----------------- Multi-session content highlights & routing -----------------
function highlightText(text) {
    if (!activeSearchTerm) return text;
    return String(text).replace(
        new RegExp(activeSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        match => `<mark class="chat-highlight">${match}</mark>`
    );
}

async function typeText(element, text, speed = 12) {
    element.textContent = "";
    for (let i = 0; i < text.length; i++) {
        element.textContent += text[i];
        await new Promise(resolve => setTimeout(resolve, speed));
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

async function addBotMessageWithSource(answer, source, sourceFile) {
    const container = document.createElement("div");
    container.className = "bot-message";

    const answerDiv = document.createElement("div");
    answerDiv.className = "typing-message";

    const sourceButton = document.createElement("button");
    sourceButton.className = "source-btn";
    sourceButton.innerText = "Sources ▼";

    const sourceDiv = document.createElement("div");
    sourceDiv.className = "source-box";

    const cleanSource = String(source || "No source available")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const fileDiv = document.createElement("div");
    fileDiv.className = "source-file";
    fileDiv.textContent = `📄 ${sourceFile || "Unknown Document"}`;

    const contentDiv = document.createElement("div");
    contentDiv.className = "source-content";
    contentDiv.innerHTML = highlightText(cleanSource);

    sourceDiv.appendChild(fileDiv);
    sourceDiv.appendChild(contentDiv);
    sourceDiv.style.display = "none";

    sourceButton.addEventListener("click", () => {
        if (sourceDiv.style.display === "none") {
            sourceDiv.style.display = "block";
            sourceButton.innerText = "Sources ▲";
        } else {
            sourceDiv.style.display = "none";
            sourceButton.innerText = "Sources ▼";
        }
    });

    container.appendChild(answerDiv);
    container.appendChild(sourceButton);
    container.appendChild(sourceDiv);
    chatBox.appendChild(container);

    await typeText(answerDiv, answer);
    answerDiv.classList.remove("typing-message");
    chatBox.scrollTop = chatBox.scrollHeight;
}

function loadSession(sessionId) {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    currentSession = session;
    localStorage.setItem("activeSessionId", String(sessionId));
    chatBox.innerHTML = "";

    if (!session.messages.length) {
        const welcome = document.createElement("div");
        welcome.className = "bot-message";
        welcome.innerText = "👋 Welcome! Upload one or more PDFs and start learning.";
        chatBox.appendChild(welcome);
        renderSessions();
        return;
    }

    session.messages.forEach(msg => {
        if (msg.type === "user") {
            addMessage(msg.text, "user");
        } else {
            const container = document.createElement("div");
            container.className = "bot-message";

            const answerDiv = document.createElement("div");
            answerDiv.innerHTML = highlightText(msg.answer);
            container.appendChild(answerDiv);

            if (msg.source || msg.sourceFile) {
                const sourceButton = document.createElement("button");
                sourceButton.className = "source-btn";
                sourceButton.innerText = "Sources ▼";

                const sourceDiv = document.createElement("div");
                sourceDiv.className = "source-box";

                const fileDiv = document.createElement("div");
                fileDiv.className = "source-file";
                fileDiv.textContent = `📄 ${msg.sourceFile}`;

                const contentDiv = document.createElement("div");
                contentDiv.className = "source-content";
                contentDiv.innerHTML = highlightText(msg.source);

                sourceDiv.appendChild(fileDiv);
                sourceDiv.appendChild(contentDiv);
                sourceDiv.style.display = "none";

                sourceButton.addEventListener("click", () => {
                    if (sourceDiv.style.display === "none") {
                        sourceDiv.style.display = "block";
                        sourceButton.innerText = "Sources ▲";
                    } else {
                        sourceDiv.style.display = "none";
                        sourceButton.innerText = "Sources ▼";
                    }
                });

                container.appendChild(sourceButton);
                container.appendChild(sourceDiv);
            }
            chatBox.appendChild(container);
        }
    });

    renderSessions();
}

function deleteSession(sessionId) {
    if (!confirm("Delete this chat?")) return;

    const wasActive = currentSession && currentSession.id === sessionId;
    sessions = sessions.filter(s => s.id !== sessionId);

    if (sessions.length === 0) {
        createNewSession();
        chatBox.innerHTML = "";
        loadSession(currentSession.id);
        renderSessions();
        return;
    }

    if (wasActive) {
        currentSession = sessions[sessions.length - 1];
        saveSessions();
        chatBox.innerHTML = "";
        loadSession(currentSession.id);
        renderSessions();
    } else {
        saveSessions();
        renderSessions();
    }
}

function applyTheme(theme) {
    document.body.classList.remove("light-theme", "dark-theme");
    document.body.classList.add(`${theme}-theme`);

    const btn = document.getElementById("themeToggleBtn");
    if (btn) {
        btn.innerText = theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
    }

    currentTheme = theme;
    localStorage.setItem("theme", theme);
    
    renderSessions();
}

// ==========================================================================
// 4. Export Engine Features
// ==========================================================================
function exportChatTXT() {
    if (!currentSession || !currentSession.messages.length) {
        alert("No chat to export.");
        return;
    }

    let content = "";
    currentSession.messages.forEach(msg => {
        if (msg.type === "user") {
            content += `USER:\n${msg.text}\n\n`;
        } else {
            content += `BOT:\n${msg.answer}\n\n`;
            if (msg.source) {
                content += `SOURCE:\n${msg.source}\n\n`;
            }
            content += "----------------------------------\n\n";
        }
    });

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentSession.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportChatPDF() {
    if (!currentSession || !currentSession.messages.length) {
        alert("No chat to export.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 15;

    doc.setFontSize(16);
    doc.text("Course Tutor AI Chat Export", 10, y);
    y += 12;

    doc.setFontSize(11);
    currentSession.messages.forEach(msg => {
        let text = "";
        if (msg.type === "user") {
            text = `USER: ${msg.text}`;
        } else {
            text = `BOT: ${msg.answer}`;
            if (msg.source) {
                text += `\nSOURCE: ${msg.source}`;
            }
        }

        const lines = doc.splitTextToSize(text, 180);
        if (y + lines.length * 7 > 280) {
            doc.addPage();
            y = 15;
        }

        doc.text(lines, 10, y);
        y += lines.length * 7 + 5;
    });

    doc.save(`${currentSession.title}.pdf`);
}

// ==========================================================================
// 5. Input & API Event Hooks
// ==========================================================================
uploadInput.addEventListener("change", async () => {
    const files = uploadInput.files;
    if (!files.length) return;

    for (const file of files) {
        const formData = new FormData();
        formData.append("pdf", file);
        formData.append("session_id", String(currentSession.id));
        
        const loaderContainer = document.createElement("div");
        loaderContainer.className = "bot-message";
        loaderContainer.innerHTML = "<span class='loading-dots'>● ● ●</span>";
        chatBox.appendChild(loaderContainer);
        chatBox.scrollTop = chatBox.scrollHeight;

        try {
            const response = await fetch("/upload", {
                method: "POST",
                headers: {
                    "X-Session-Id": String(currentSession.id)
                },
                body: formData
            });
            const data = await response.json();
            loaderContainer.remove();
            
            if (!response.ok) {
                addMessage(`❌ ${data.message || "Upload failed."}`, "bot");
                continue;
            }

            addMessage("📄 " + data.message, "bot");

            if (currentSession) {
                currentSession.messages.push({
                    type: "bot",
                    answer: "📄 " + data.message,
                    source: "",
                    sourceFile: ""
                });
            }

            if (currentSession && currentSession.title === "New Chat") {
                currentSession.title = file.name;
            }
            
            saveSessions();
            renderSessions();

        } catch (error) {
            loaderContainer.remove();
            addMessage("❌ Upload failed: " + file.name, "bot");
            console.error(error);
        }
    }
    uploadInput.value = "";
});

async function sendMessage() {
    const question = questionInput.value.trim();
    if (!question) return;

    if (currentSession && currentSession.title === "New Chat") {
        currentSession.title = question.length > 30 ? question.substring(0, 30) + "..." : question;
        saveSessions();
        renderSessions();
    }

    addMessage(question, "user");
    questionInput.value = "";

    if (currentSession) {
        currentSession.messages.push({
            type: "user",
            text: question
        });
        saveSessions();
    }

    const loaderContainer = document.createElement("div");
    loaderContainer.className = "bot-message";
    loaderContainer.innerHTML = "<span class='loading-dots'>● ● ●</span>";
    chatBox.appendChild(loaderContainer);
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const response = await fetch("/ask", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Session-Id": String(currentSession.id)
            },
            body: JSON.stringify({
                question: question,
                session_id: String(currentSession.id)
            })
        });

        const data = await response.json();
        loaderContainer.remove();

        const answer = data.answer || "No answer found";

        await addBotMessageWithSource(
            answer,
            data.source || "No source available",
            data.document || "Unknown Document"
        );

        if (currentSession) {
            currentSession.messages.push({
                type: "bot",
                answer: answer,
                source: data.source || "No source available",
                sourceFile: data.document || "Unknown Document"
            });
            saveSessions();
        }

    } catch (error) {
        console.error("ERROR:", error);
        loaderContainer.remove();
        addMessage("❌ Something went wrong.", "bot");
    }
}

// ==========================================================================
// 6. Application Startup & Initialization Sequence
// ==========================================================================
applyTheme(currentTheme);

if (!loadSessionsFromStorage()) {
    createNewSession();
}
loadSession(currentSession.id);
renderSessions();

askBtn.addEventListener("click", sendMessage);
questionInput.addEventListener("keypress", function(e) {
    if (e.key === "Enter") sendMessage();
});

if (exportBtn) {
    exportBtn.addEventListener("click", () => {
        const choice = prompt("Type PDF or TXT");
        if (!choice) return;

        if (choice.toLowerCase() === "pdf") {
            exportChatPDF();
        } else if (choice.toLowerCase() === "txt") {
            exportChatTXT();
        } else {
            alert("Enter PDF or TXT");
        }
    });
}

const themeToggleBtn = document.getElementById("themeToggleBtn");
if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
        applyTheme(currentTheme === "dark" ? "light" : "dark");
    });
}

const newChatBtn = document.getElementById("newChatBtn");
if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
        if (currentSession && currentSession.title === "New Chat" && currentSession.messages.length === 0) {
            return;
        }
        createNewSession();
        loadSession(currentSession.id);
        renderSessions();
    });
}

if (searchInput) {
    searchInput.addEventListener("input", () => {
        activeSearchTerm = searchInput.value.trim().toLowerCase();
        if (clearSearchBtn) {
            if (activeSearchTerm) {
                clearSearchBtn.style.opacity = "1";
                clearSearchBtn.style.pointerEvents = "auto";
            } else {
                clearSearchBtn.style.opacity = "0";
                clearSearchBtn.style.pointerEvents = "none";
            }
        }
        renderSessions();
        if (currentSession) loadSession(currentSession.id);
    });
}

if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        activeSearchTerm = "";
        clearSearchBtn.style.opacity = "0";
        clearSearchBtn.style.pointerEvents = "none";
        renderSessions();
        if (currentSession) loadSession(currentSession.id);
        searchInput.focus();
    });
}

document.addEventListener("click", () => {
    document.querySelectorAll(".session-menu").forEach(menu => {
        menu.style.display = "none";
    });
});