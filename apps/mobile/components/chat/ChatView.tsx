import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { getMemberId } from "@/lib/auth";
import { EmptyState } from "@/components/ui/EmptyState";
import { colors, spacing, radius } from "@/lib/theme";
import { LinkPreview } from "./LinkPreview";
import { ImageMessage } from "./ImageMessage";

interface ChatViewProps {
  chatId: string;
  eventId?: string | null;
  emptyTitle?: string;
  emptySubtitle?: string;
}

const URL_REGEX = /https?:\/\/[^\s]+/;

export function ChatView({
  chatId,
  eventId,
  emptyTitle = "Noch keine Nachrichten",
  emptySubtitle = "Schreib die erste Nachricht!",
}: ChatViewProps) {
  const [message, setMessage] = useState("");
  const [myId, setMyId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    getMemberId().then(setMyId);
  }, []);

  const { data } = useQuery({
    queryKey: ["chat", chatId],
    queryFn: () => apiGet(`/v2/chat/${chatId}/messages`),
    refetchInterval: 3000,
    enabled: !!chatId,
  });

  const messages: any[] = data?.messages || [];

  async function sendMessage() {
    if (!message.trim()) return;
    const content = message.trim();
    setMessage("");
    try {
      await apiPost(`/v2/chat/${chatId}/messages`, {
        content,
        eventId: eventId || undefined,
      });
    } catch {}
  }

  function renderMessage({ item }: { item: any }) {
    const isMe = item.senderId === myId;

    return (
      <View
        style={[styles.bubble, isMe ? styles.myBubble : styles.otherBubble]}
      >
        {!isMe && (
          <View style={styles.senderRow}>
            {item.senderAvatar ? (
              <Text style={styles.senderEmoji}>{item.senderAvatar}</Text>
            ) : null}
            <Text style={styles.senderName}>
              {item.senderName || "Unbekannt"}
            </Text>
          </View>
        )}

        {item.type === "image" && item.mediaUrl ? (
          <ImageMessage uri={item.mediaUrl} isMe={isMe} />
        ) : null}

        {item.content ? (
          <Text style={[styles.messageText, isMe && styles.myText]}>
            {item.content}
          </Text>
        ) : null}

        {item.linkPreview ? (
          <LinkPreview preview={item.linkPreview} />
        ) : item.content && URL_REGEX.test(item.content) ? (
          <LinkPreview url={item.content.match(URL_REGEX)?.[0]} />
        ) : null}

        <Text style={[styles.time, isMe && styles.myTime]}>
          {new Date(item.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <EmptyState
            emoji="🤫"
            title={emptyTitle}
            subtitle={emptySubtitle}
          />
        }
      />
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Nachricht..."
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={5000}
        />
        <TouchableOpacity
          style={[styles.sendButton, !message.trim() && styles.sendDisabled]}
          onPress={sendMessage}
          disabled={!message.trim()}
        >
          <View style={styles.sendCircle}>
            <Text style={styles.sendArrow}>↑</Text>
          </View>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  messageList: {
    padding: spacing.lg,
    gap: spacing.sm,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  bubble: { maxWidth: "80%", padding: spacing.md, marginBottom: 4 },
  myBubble: {
    backgroundColor: colors.navy,
    alignSelf: "flex-end",
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: colors.white,
    alignSelf: "flex-start",
    borderRadius: radius.lg,
    borderBottomLeftRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  senderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  senderEmoji: { fontSize: 14 },
  senderName: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.coral,
  },
  messageText: { fontSize: 16, color: colors.navy, lineHeight: 22 },
  myText: { color: colors.white },
  time: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  myTime: { color: "rgba(255,255,255,0.4)" },
  inputBar: {
    flexDirection: "row",
    padding: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: 1.5,
    borderTopColor: colors.border,
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.creamDark,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.navy,
    maxHeight: 100,
  },
  sendButton: {},
  sendDisabled: { opacity: 0.3 },
  sendCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  sendArrow: {
    color: colors.white,
    fontSize: 20,
    fontWeight: "700",
    marginTop: -2,
  },
});
