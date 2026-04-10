import { useState } from "react";
import { View, Image, StyleSheet, Animated } from "react-native";
import { colors } from "@/lib/theme";

interface ProgressiveImageProps {
  uri: string;
  thumbnailUri?: string;
  style?: any;
  resizeMode?: "cover" | "contain" | "stretch";
}

export function ProgressiveImage({
  uri,
  thumbnailUri,
  style,
  resizeMode = "cover",
}: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(false);
  const fullOpacity = useState(new Animated.Value(0))[0];

  function onFullLoad() {
    setLoaded(true);
    Animated.timing(fullOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }

  return (
    <View style={[styles.container, style]}>
      {/* Blur placeholder / thumbnail */}
      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
          style={[StyleSheet.absoluteFill, { opacity: loaded ? 0 : 1 }]}
          resizeMode={resizeMode}
          blurRadius={10}
        />
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.placeholder,
            { opacity: loaded ? 0 : 1 },
          ]}
        />
      )}

      {/* Full resolution image */}
      <Animated.Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, { opacity: fullOpacity }]}
        resizeMode={resizeMode}
        onLoad={onFullLoad}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    backgroundColor: colors.creamDark,
  },
  placeholder: {
    backgroundColor: colors.creamDark,
  },
});
