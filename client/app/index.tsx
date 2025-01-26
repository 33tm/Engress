import { useEffect, useState } from "react"
import { Text, Alert, View, ScrollView, TextInput } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { openSettings } from "expo-linking"
import { StatusBar } from "expo-status-bar"
import { impactAsync, ImpactFeedbackStyle } from "expo-haptics"

import {
    activateKeepAwakeAsync,
    deactivateKeepAwake
} from "expo-keep-awake"

import {
    ExpoAudioStreamModule,
    useAudioRecorder
} from "@siteed/expo-audio-stream"

export default function Index() {
    const [connection, setConnection] = useState<WebSocket>()
    const [connecting, setConnecting] = useState(false)

    const [topics, setTopics] = useState<{
        data: string
        completed: boolean
    }[]>([])

    const {
        startRecording,
        stopRecording,
        isRecording
    } = useAudioRecorder()

    useEffect(() => {
        if (isRecording) activateKeepAwakeAsync()
        else deactivateKeepAwake()
    }, [isRecording])

    async function toggleSession() {
        if (connecting || !topics.length) return

        if (connection || isRecording) {
            connection?.close()
            setConnection(undefined)
            stopRecording()
            setTopics(topics.map(topic => ({ ...topic, completed: false })))
            return
        }

        const { granted } = await ExpoAudioStreamModule.requestPermissionsAsync()

        if (!granted) {
            Alert.alert(
                "Permission Denied",
                "Allow microphone access in settings.",
                [
                    { text: "Cancel", style: "cancel" },
                    { text: "Settings", onPress: openSettings }
                ]
            )
            return
        }

        setConnecting(true)

        const ws = new WebSocket("ws://10.0.0.108:443")

        ws.onopen = async () => {
            ws.send(JSON.stringify(topics.map(({ data }) => data)))

            ws.onmessage = async ({ data }) => {
                if (data === "READY" && !connection) {
                    setConnection(ws)
                    setConnecting(false)
                    await startRecording({
                        interval: 1000,
                        sampleRate: 16000,
                        encoding: "pcm_16bit",
                        keepAwake: true,
                        onAudioStream: async ({ data }) => {
                            ws.send(data)
                        }
                    })
                } else {
                    const [type, message, timestamp] = JSON.parse(data)
                    switch (type) {
                        case 0: {
                            console.log(`TRANSCRIBED: ${message}`)
                            break
                        }
                        case 1: {
                            console.log(`RESPONSE: ${message}`)
                            impactAsync(ImpactFeedbackStyle.Heavy)
                            const indexes = message.split(" ")
                            setTopics(topics.map((topic, i) => {
                                if (indexes.includes((i + 1).toString()))
                                    topic.completed = true
                                return topic
                            }))
                            break
                        }
                    }
                }
            }

            ws.onclose = () => {
                setConnection(undefined)
                stopRecording()
            }
        }
    }

    return (
        <SafeAreaView
            style={{
                backgroundColor: "#000000",
                height: "100%",
                flexDirection: "column"
            }}
        >
            <StatusBar style="light" />
            <View
                style={{
                    padding: 15
                }}
            >
                <Text
                    style={{
                        color: "#FFFFFF",
                        fontFamily: "DM-Regular",
                        fontSize: 30,
                        lineHeight: 30
                    }}
                >
                    Engress
                </Text>
            </View>
            <View
                style={{
                    height: "100%",
                    flexDirection: "column"
                }}
            >
                {!connection && (
                    <View
                        style={{
                            backgroundColor: "#222222",
                            borderRadius: 10,
                            marginBottom: 5
                        }}
                    >
                        <Text
                            style={{
                                color: "#FFFFFF",
                                fontFamily: "Geist-Regular",
                                fontSize: 16,
                                lineHeight: 20,
                                textAlign: "center",
                                padding: 15
                            }}
                            onPress={() => setTopics([
                                ...topics,
                                { data: "", completed: false }
                            ])}
                        >
                            New Topic
                        </Text>
                    </View>
                )}
                <ScrollView style={{ borderRadius: 10 }}>
                    {topics.length
                        ? topics
                            .sort(({ completed: a }, { completed: b }) => a === b ? 0 : a ? 1 : -1)
                            .map(({ data, completed }, index) => (
                                <View
                                    key={index}
                                    style={{
                                        flexDirection: "row",
                                        justifyContent: "space-between",
                                        backgroundColor: "#111111",
                                        padding: 15,
                                        marginBottom: 5,
                                        opacity: completed ? 0.25 : 0.75,
                                        borderRadius: 10
                                    }}
                                >
                                    <TextInput
                                        style={{
                                            color: "#FFFFFF",
                                            textDecorationLine: completed ? "line-through" : "none",
                                            fontFamily: "Geist-Regular",
                                            fontSize: 20,
                                            lineHeight: 25,
                                            marginVertical: "auto",
                                            width: "80%"
                                        }}
                                        onChangeText={(text) => {
                                            const newTopics = [...topics]
                                            newTopics[index].data = text
                                            setTopics(newTopics)
                                        }}
                                        editable={!connection}
                                        autoFocus
                                        multiline
                                    >
                                        {data}
                                    </TextInput>
                                    {!connection && (
                                        <Text
                                            style={{
                                                color: "#FFFFFF",
                                                fontFamily: "Geist-Regular",
                                                fontSize: 20,
                                                lineHeight: 25,
                                                marginVertical: "auto"
                                            }}
                                            onPress={() => setTopics(topics.filter((_, i) => i !== index))}
                                        >
                                            x
                                        </Text>
                                    )}
                                </View>
                            )) : (
                            <Text
                                style={{
                                    color: "#FFFFFF",
                                    fontFamily: "Geist-Regular",
                                    fontSize: 12,
                                    textAlign: "center",
                                    padding: 30
                                }}
                            >
                                No Topics...
                            </Text>
                        )
                    }
                </ScrollView>
                <View
                    style={{
                        marginBottom: 60
                    }}
                >
                    <Text
                        style={{
                            backgroundColor: "#FFFFFF",
                            borderRadius: 10,
                            fontFamily: "Geist-Regular",
                            fontSize: 16,
                            lineHeight: 20,
                            textAlign: "center",
                            padding: 15
                        }}
                        onPress={toggleSession}
                    >
                        {isRecording ? "Stop Presenting" : "Present"}
                    </Text>
                </View>
            </View>
        </SafeAreaView >
    )
}