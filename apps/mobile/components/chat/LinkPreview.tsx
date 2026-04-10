import { View, Text, Image, StyleSheet, TouchableOpacity, Linking } from "react-native";
import { colors, spacing, radius } from "@/lib/theme";

interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
}

interface LinkPreviewProps {
  preview?: LinkPreviewData;
  url?: string;
}

export function LinkPreview({ preview, url }: LinkPreviewProps) {
  const displayUrl = preview?.url || url;
  if (!displayUrl) return null;

  const title = preview?.title;
  const description = preview?.description;
  const imageUrl = preview?.imageUrl;

  function handlePress() {
    if (displayUrl) Linking.openURL(displayUrl);
  }

  if (!title && !description && !imageUrl) {
    return (
      <TouchableOpacity onPress={handlePress} style={styles.minimalLink}>
        <Text style={styles.linkUrl} numberOfLines={1}>
          {displayUrl}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onPress={handlePress} style={styles.container}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} />
      ) : null}
      <View style={styles.content}>
        {title ? (
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        {description ? (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        <Text style={styles.domain} numberOfLines={1}>
          {new URL(displayUrl).hostname}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.creamDark,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: {
    width: "100%",
    height: 120,
    backgroundColor: colors.creamDark,
  },
  content: {
    padding: spacing.sm,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.navy,
  },
  description: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  domain: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  minimalLink: {
    marginTop: 4,
  },
  linkUrl: {
    fontSize: 14,
    color: colors.info,
    textDecorationLine: "underline",
  },
});
