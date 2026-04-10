import { useState } from "react";
import {
  Image,
  StyleSheet,
  TouchableOpacity,
  Modal,
  View,
  Text,
  Dimensions,
} from "react-native";
import { colors, radius, spacing } from "@/lib/theme";

interface ImageMessageProps {
  uri: string;
  isMe: boolean;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } =
  Dimensions.get("window");

export function ImageMessage({ uri, isMe }: ImageMessageProps) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <TouchableOpacity
        onPress={() => setFullscreen(true)}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri }}
          style={[styles.thumbnail, isMe && styles.thumbnailMe]}
          resizeMode="cover"
        />
      </TouchableOpacity>

      <Modal
        visible={fullscreen}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setFullscreen(false)}
        >
          <Image
            source={{ uri }}
            style={styles.fullImage}
            resizeMode="contain"
          />
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setFullscreen(false)}
          >
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    width: 200,
    height: 150,
    borderRadius: radius.sm,
    marginBottom: 4,
    backgroundColor: colors.creamDark,
  },
  thumbnailMe: {
    borderRadius: radius.sm,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  closeButton: {
    position: "absolute",
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: "700",
  },
});
