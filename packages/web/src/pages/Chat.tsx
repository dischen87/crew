import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAuth } from "../contexts/AuthContext";
import { getMessages, sendMessage } from "../lib/api";
import { IconSend, IconArrowLeft } from "../components/Icons";
import { Spinner } from "../components/Motion";
import Emoji from "../components/Emoji";
import GiphyPicker from "../components/GiphyPicker";

function isGifUrl(text: string): boolean {
  if (!text) return false;
  return /\.(gif)(\?|$)/i.test(text) || /giphy\.com\/media/i.test(text) || /media\d*\.giphy\.com/i.test(text);
}

export default function Chat() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const { eventId } = useParams({ from: "/events/$eventId" });
  const onClose = () => navigate({ to: `/events/${eventId}` });
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showGiphy, setShowGiphy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const prevCountRef = useRef(0);

  const loadMessages = useCallback(async () => {
    if (!auth) return;
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
  }, [auth?.group?.id]);

  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(loadMessages, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadMessages]);

  if (!auth) return null;

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
    inputRef.current?.focus();
  };

  const handleGifSelect = async (gifUrl: string) => {
    setShowGiphy(false);
    setSending(true);
    try {
      await sendMessage(auth.group.id, gifUrl, auth.event.id);
      await loadMessages();
    } catch (err) {
      console.error("Failed to send GIF:", err);
    }
    setSending(false);
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

  return (
    <div className="flex flex-col -mx-5 -my-6" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Chat Header */}
      <div className="shrink-0 bg-white border-b-3 border-dark px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight leading-tight">Chat</h2>
            <p className="text-[10px] text-dark/40 font-bold uppercase tracking-wider">
              {auth.group.name} · {messages.length} Nachrichten
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 min-h-0 overscroll-none bg-surface-0">
        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <span className="text-4xl mb-3">💬</span>
            <p className="text-sm text-dark/40 font-bold">Noch keine Nachrichten</p>
            <p className="text-xs text-dark/25 mt-1">Schreib die erste!</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {messages.map((msg, msgIndex) => {
              const dateStr = new Date(msg.created_at).toDateString();
              let showDateHeader = false;
              if (dateStr !== lastDate) {
                showDateHeader = true;
                lastDate = dateStr;
              }
              const isMe = msg.sender_id === auth.member.id;
              const isActivity = msg.type === "activity";
              const isGif = isGifUrl(msg.content);

              return (
                <div key={msg.id}>
                  {showDateHeader && (
                    <div className="flex justify-center my-4">
                      <span className="text-[10px] text-dark/40 font-bold uppercase tracking-wider bg-white border-2 border-dark/10 px-4 py-1.5 rounded-full">
                        {formatDateHeader(msg.created_at)}
                      </span>
                    </div>
                  )}

                  {isActivity ? (
                    <div className="flex justify-center mb-2">
                      <div className="max-w-[85%] px-4 py-2 bg-accent-mint/30 border border-dark/10 rounded-2xl text-center">
                        <p className="text-[10px] font-bold text-dark/50 mb-0.5">
                          <Emoji emoji={msg.sender_emoji || "👤"} size={12} className="mr-1" />
                          {msg.sender_name}
                        </p>
                        <p className="text-[13px] font-semibold leading-snug">{msg.content}</p>
                        <p className="text-[10px] text-dark/30 mt-1">{formatTime(msg.created_at)}</p>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex ${isMe ? "justify-end" : "justify-start"} mb-1.5`}>
                      {!isMe && (
                        <span className="w-7 h-7 bg-white border-2 border-dark rounded-full flex items-center justify-center shrink-0 mr-2 mt-1">
                          <Emoji emoji={msg.sender_emoji || "👤"} size={14} />
                        </span>
                      )}
                      <div className={`max-w-[78%] ${isGif ? "" : "px-4 py-2.5"} border-2 border-dark rounded-2xl overflow-hidden ${
                        isMe
                          ? "bg-gold-400 rounded-br-md shadow-brutal-xs"
                          : "bg-white rounded-bl-md shadow-brutal-xs"
                      }`}>
                        {!isMe && (
                          <p className={`text-[10px] font-bold text-dark/50 mb-1 ${isGif ? "px-3 pt-2" : ""}`}>
                            {msg.sender_name || "Unbekannt"}
                          </p>
                        )}

                        {isGif ? (
                          <img
                            src={msg.content}
                            alt="GIF"
                            className="w-full max-h-52 object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <p className="text-[14px] whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                        )}

                        {msg.link_preview && !isGif && (
                          <a href={msg.link_preview.url} target="_blank" rel="noopener noreferrer" className="block mt-2 bg-surface-0 border border-dark/10 rounded-xl overflow-hidden no-underline">
                            {msg.link_preview.image_url && (
                              <img src={msg.link_preview.image_url} alt="" className="w-full h-24 object-cover" loading="lazy" />
                            )}
                            <div className="p-2">
                              {msg.link_preview.title && <p className="text-[11px] font-bold text-dark truncate">{msg.link_preview.title}</p>}
                              {msg.link_preview.description && <p className="text-[10px] text-dark/50 line-clamp-2 mt-0.5">{msg.link_preview.description}</p>}
                            </div>
                          </a>
                        )}

                        <p className={`text-[10px] mt-1 ${isGif ? "px-3 pb-1.5" : ""} ${isMe ? "text-dark/30" : "text-dark/25"}`}>
                          {formatTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="shrink-0 bg-white border-t-2 border-dark/10 pb-2">
        <form onSubmit={handleSend} className="px-4 py-2.5">
          <div className="flex gap-2 items-end">
            <motion.button
              type="button"
              onClick={() => setShowGiphy(true)}
              className="w-11 h-11 flex items-center justify-center shrink-0 rounded-xl border-2 border-dark/15 bg-surface-0 text-dark/50"
              whileTap={{ scale: 0.9 }}
            >
              <span className="text-[11px] font-extrabold">GIF</span>
            </motion.button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Nachricht..."
              className="flex-1 px-4 py-2.5 input-soft text-[15px]"
              autoComplete="off"
              enterKeyHint="send"
            />
            <motion.button
              type="submit"
              disabled={!input.trim() || sending}
              className="w-11 h-11 flex items-center justify-center shrink-0 rounded-xl border-2 border-dark bg-gold-400 shadow-brutal-xs disabled:opacity-20"
              whileTap={{ scale: 0.9 }}
            >
              <IconSend className="w-5 h-5" />
            </motion.button>
          </div>
        </form>
      </div>

      {/* Giphy Fullscreen Overlay */}
      <AnimatePresence>
        {showGiphy && (
          <GiphyPicker onSelect={handleGifSelect} onClose={() => setShowGiphy(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
