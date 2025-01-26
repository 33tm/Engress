import { Stack } from "expo-router"
import { useFonts } from "expo-font"

export default function RootLayout() {
    useFonts({
        "Geist-Regular": require("../assets/fonts/Geist-Regular.ttf"),
        "DM-Regular": require("../assets/fonts/DMSerifText-Regular.ttf")
    })

    return (
        <Stack screenOptions={{ headerShown: false }} />
    )
}