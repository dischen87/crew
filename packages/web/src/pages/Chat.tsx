import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { getMessages, sendMessage } from "../lib/api";
import { IconSend, IconArrowLeft } from "../components/Icons";
import { Spinner } from "../components/Motion";
import Emoji from "../components/Emoji";
import GiphyPicker from "../components/GiphyPicker";

interface Props {
  auth: {
    member: { id: string; display_name: string };
    group: { id: string; name: string };
    event: { id: string };
  };
  onClose?: () => void;
}

export default function Chat({ auth, onClose }: Props) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const prevCountRef = useRef(0);

  const loadMessages = useCallback(async () => {
    try {
      const data = await getMessages(auth.group.id, 100);
      const msgs = [...(data.messages || [])].reverse();
      setMessages(msgs);
      setLoading(false);
      if (msgs.length !== prevCountRef.current) {
        prevCountRef.current = msgs.length;
        setTimeout(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
        }, 100);
      }
    } catch (err) {
      console.error("Failed to load messages:", err);
      setLoading(false);
    }
  }, [auth.group.id]);

  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(loadMessages, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadMessages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput("");
    try {
      await sendMessage(auth.group.id, text, auth.event.id);
      await loadMessages();
    } catch (err) {
      console.error("Failed to send:", err);
      setInput(text);
    }
    setSending(false);
    // Refocus input after send so keyboard stays open
    inputRef.current?.focus();
  };

  const formatTime = (d: string) =>
    new Date(d).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });

  const formatDateHeader = (d: string) => {
    const date = new Date(d);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return "Heute";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Gestern";
    return date.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  };

  let lastDate = "";

  const [showGiphy, setShowGiphy] = useState(false);

  const handleGifSelect = async (gifUrl: string) => {
    setShowGiphy(false);
    try {
      await sendMessage(auth.group.id, gifUrl, auth.event.id);
      await loadMessages();
    } catch (err) {
      console.error("Failed to send GIF:", err);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[10000] bg-surface-0 flex flex-col"
      style={{ height: "100dvh" }}
      initial={{ opacity: 0, y: "100%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: "100%" }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {/* Chat Header — fixed, always visible */}
      <div className="shrink-0 bg-white border-b-3 border-dark" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <motion.button
            onClick={onClose || (() => {})}
            className="w-10 h-10 bg-surface-0 border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs shrink-0"
            whileTap={{ scale: 0.9 }}
          >
            <IconArrowLeft className="w-5 h-5 text-dark" />
          </motion.button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight">Chat</h2>
            <p className="text-[10px] text-dark/40 font-bold uppercase tracking-wider">
              {auth.group.name} · {messages.length} Nachrichten
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1 min-h-0 overscroll-contain bg-surface-0 bg-grid">
        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : (
          <>
            {messages.length === 0 && (
              <p className="text-sm text-dark/40 text-center py-10 font-medium">
                Noch keine Nachrichten. Schreib die erste!
              </p>
            )}

            {messages.map((msg, msgIndex) => {
              const dateStr = new Date(msg.created_at).toDateString();
              let showDateHeader = false;
              if (dateStr !== lastDate) {
                showDateHeader = true;
                lastDate = dateStr;
              }
              const isMe = msg.sender_id === auth.member.id;
              const isActivity = msg.type === "activity";

              return (
                <div key={msg.id}>
                  {showDateHeader && (
                    <div className="flex justify-center my-5">
                      <span className="text-[10px] text-dark/40 font-bold uppercase tracking-wider bg-white border-2 border-dark/15 px-4 py-1.5 rounded-full">
                        {formatDateHeader(msg.created_at)}
                      </span>
                    </div>
                  )}

                  {isActivity ? (
                    <motion.div
                      className="flex justify-center mb-2"
                      initial={msgIndex === messages.length - 1 ? { opacity: 0, y: 6 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="max-w-[90%] px-4 py-2.5 bg-accent-mint/40 border-2 border-dark/10 rounded-2xl text-center">
                        <p className="text-[10px] font-bold text-dark/50 mb-0.5">
                          <Emoji emoji={msg.sender_emoji || "👤"} size={12} className="mr-1" />
                          {msg.sender_name}
                        </p>
                        <p className="text-[13px] font-semibold leading-snug">{msg.content}</p>
                        <p className="text-[10px] text-dark/40 mt-1">{formatTime(msg.created_at)}</p>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      className={`flex ${isMe ? "justify-end" : "justify-start"} mb-2`}
                      initial={msgIndex === messages.length - 1 ? { opacity: 0, y: 6, scale: 0.97 } : false}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      {!isMe && (
                        <span className="w-7 h-7 bg-white border-2 border-dark rounded-full flex items-center justify-center shrink-0 mr-2 mt-1">
                          <Emoji emoji={msg.sender_emoji || "👤"} size={16} />
                        </span>
                      )}
                      <div
                        className={`max-w-[75%] px-4 py-3 border-2 border-dark rounded-2xl ${
                          isMe
                            ? "bg-gold-400 rounded-br-md shadow-brutal-xs"
                            : "bg-white rounded-bl-md shadow-brutal-xs"
                        }`}
                      >
                        {!isMe && (
                          <p className="text-[10px] font-bold text-dark/50 mb-1">
                            {msg.sender_name}
                          </p>
                        )}
                        {/* GIF / Image detection */}
                        {msg.content?.match(/https?:\/\/[^\s]+\.(gif|giphy\.com)[^\s]*/i) ? (
                          <img
                            src={msg.content.match(/https?:\/\/[^\s]+/)?.[0]}
                            alt="GIF"
                            className="rounded-xl max-w-full max-h-48 object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <p className="text-[14px] whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                        )}
                        {msg.link_preview && (
                          <a href={msg.link_preview.url} target="_blank" rel="noopener noreferrer" className="block mt-2 bg-surface-0 border-2 border-dark/10 rounded-xl overflow-hidden no-underline hover:bg-dark/5 transition-colors">
                            {msg.link_preview.image_url && (
                              <img src={msg.link_preview.image_url} alt="" className="w-full h-28 object-cover" loading="lazy" />
                            )}
                            <div className="p-2.5">
                              {msg.link_preview.title && <p className="text-xs font-bold text-dark truncate">{msg.link_preview.title}</p>}
                              {msg.link_preview.description && <p className="text-[10px] text-dark/50 line-clamp-2 mt-0.5">{msg.link_preview.description}</p>}
                              <p className="text-[9px] text-dark/30 mt-1">{new URL(msg.link_preview.url).hostname}</p>
                            </div>
                          </a>
                        )}
                        <p className={`text-[10px] mt-1.5 ${isMe ? "text-dark/30" : "text-dark/30"}`}>
                          {formatTime(msg.created_at)}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Input bar */}
      <form onSubmit={handleSend} className="shrink-0 border-t-3 border-dark bg-white" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="relative px-4 py-3">
          <AnimatePresence>
            {showGiphy && (
              <GiphyPicker onSelect={handleGifSelect} onClose={() => setShowGiphy(false)} />
            )}
          </AnimatePresence>
          <div className="flex gap-2 max-w-lg mx-auto">
            <motion.button
              type="button"
              onClick={() => setShowGiphy(!showGiphy)}
              className={`w-12 h-12 flex items-center justify-center shrink-0 rounded-xl border-2 transition-all ${
                showGiphy ? "border-dark bg-dark text-white" : "border-dark/15 bg-surface-0 text-dark/40"
              }`}
              whileTap={{ scale: 0.9 }}
            >
              <span className="text-lg">GIF</span>
            </motion.button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Nachricht..."
              className="flex-1 px-4 py-3 input-soft"
              autoComplete="off"
              enterKeyHint="send"
            />
            <motion.button
              type="submit"
              disabled={!input.trim() || sending}
              className="btn-gold disabled:opacity-20 w-12 h-12 flex items-center justify-center shrink-0"
              whileTap={{ scale: 0.9 }}
            >
              <IconSend className="w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </form>
    </motion.div>
  );
}
