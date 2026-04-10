import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { apiGet, apiPost } from "@/lib/api";
import { saveMemberId, saveGroupId } from "@/lib/auth";
import { colors, spacing, radius } from "@/lib/theme";

export default function DeepLinkJoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [loading, setLoading] = useState(false);
  const [groupInfo, setGroupInfo] = useState<{
    name: string;
    memberCount: number;
  } | null>(null);
  const [validating, setValidating] = useState(true);

  useEffect(() => {
    if (code) {
      validateCode(code);
    }
  }, [code]);

  async function validateCode(inviteCode: string) {
    try {
      const res = await apiGet(`/v2/auth/invite/${inviteCode}`);
      setGroupInfo({
        name: res.group.name,
        memberCount: res.group.memberCount,
      });
    } catch {
      Alert.alert("Fehler", "Ungueltiger Invite-Code");
    } finally {
      setValidating(false);
    }
  }

  async function handleJoin() {
    if (!firstName.trim() || !code) return;

    setLoading(true);
    try {
      const res = await apiPost("/v2/auth/join", {
        inviteCode: code.toUpperCase(),
        displayName: firstName.trim(),
      });

      await saveMemberId(res.member.id);
      await saveGroupId(res.group.id);

      router.replace("/(app)/(tabs)/home" as any);
    } catch (err: any) {
      Alert.alert("Fehler", err.message || "Beitreten fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  if (validating) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.navy} />
        <Text style={styles.validatingText}>Code wird geprueft...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>C</Text>
        </View>

        {groupInfo ? (
          <>
            <Text style={styles.title}>Willkommen!</Text>
            <Text style={styles.description}>
              Du wurdest zur Crew "{groupInfo.name}" eingeladen.
              {groupInfo.memberCount > 0 &&
                ` ${groupInfo.memberCount} Mitglieder sind bereits dabei.`}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Crew beitreten</Text>
            <Text style={styles.description}>
              Der Invite-Code konnte nicht verifiziert werden.
            </Text>
          </>
        )}

        <View style={styles.codeBadge}>
          <Text style={styles.codeLabel}>Invite Code</Text>
          <Text style={styles.codeValue}>{code}</Text>
        </View>
      </View>

      <View style={styles.form}>
        <Input
          label="Dein Vorname"
          value={firstName}
          onChangeText={setFirstName}
          placeholder="z.B. Mathias"
          autoCorrect={false}
          autoFocus
        />

        <Button
          title="Beitreten"
          onPress={handleJoin}
          loading={loading}
          disabled={!firstName.trim() || !groupInfo}
          size="lg"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    padding: spacing.lg,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.cream,
    gap: spacing.md,
  },
  validatingText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  headerSection: {
    alignItems: "center",
    marginBottom: spacing.xl,
    paddingTop: spacing.xl,
  },
  logoBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  logoText: {
    fontFamily: "Georgia",
    fontSize: 28,
    fontWeight: "700",
    color: colors.coral,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.navy,
    fontFamily: "Georgia",
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: 16,
    color: colors.textSecondary,
    lineHeight: 24,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  codeBadge: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: "center",
    width: "100%",
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  codeValue: {
    fontFamily: "Georgia",
    fontSize: 24,
    fontWeight: "800",
    color: colors.navy,
    letterSpacing: 4,
  },
  form: {
    gap: 4,
  },
});
