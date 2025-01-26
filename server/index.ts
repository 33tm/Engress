import { serve, file, randomUUIDv7, Glob, $ } from "bun"
import { existsSync, mkdirSync } from "fs"
import { resolve } from "path"

import { FileWriter } from "wav"
import OpenAI from "openai"

interface Connection {
    start: number
    topics: string[]
    path?: string
    writer?: FileWriter
    begin?: number
    length: number
    silence: number
}

const connections = new Map<string, Connection>()

const openai = new OpenAI()

if (!existsSync("temp"))
    mkdirSync("temp")

if (!existsSync("whisper"))
    await $`sh whisper-metal.sh`

const temp = (pattern: string) => new Glob(pattern).scan("temp")

for await (const filename of temp("*"))
    file(`temp/${filename}`).delete()

async function transcribe(filename: string) {
    const transcript = await $`whisper/build/bin/whisper-cli -f ${resolve(filename)} -m whisper/models/ggml-large-v3-turbo.bin -np -nt`
        .quiet()
        .text()

    file(filename).delete()

    return transcript.trim()
}

async function inference(input: string, topics: string[]) {
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content: prompt + topics
                    .map((point, index) => `${index + 1}. ${point}`)
                    .join("\n")
            },
            {
                role: "user",
                content: input
            }
        ]
    })

    const { content } = response.choices[0].message

    return content && /[\d\s!]/.test(content) ? content : "!"
}

serve({
    port: 443,
    websocket: {
        open(ws) {
            console.log("Connection established.")
            connections.set(ws.data as string, {
                start: Date.now(),
                topics: [],
                length: 0,
                silence: 0
            })
        },
        async close(ws) {
            const id = ws.data as string
            console.log(`Connection closed after ${Date.now() - connections.get(id)!.start}ms.`)
            for await (const filename of temp(`${id}-*`))
                file(`temp/${filename}`).delete()
            connections.delete(id)
        },
        message(ws, data) {
            const id = ws.data as string
            const current = connections.get(id)

            if (!current) return

            if (!current.topics.length) {
                if (typeof data !== "string") return
                current.topics.push(...JSON.parse(data))
                ws.send("READY")
                return
            }

            const buffer = typeof data === "string"
                ? Buffer.from(data, "base64")
                : data

            const samples = new Float32Array(
                Array.from({
                    length: buffer.length / 2
                }, (_, i) => buffer.readInt16LE(i * 2) / 32768)
            )

            let max = 0
            for (const sample of samples)
                if (sample > max)
                    max = sample

            if (max > 0.1) {
                console.log(`WRITING: ${max}`)

                if (!current.writer) {
                    current.path = `temp/${id}-${Date.now()}.wav`
                    current.writer = new FileWriter(current.path, {
                        channels: 1,
                        sampleRate: 16000,
                        bitDepth: 16
                    })
                    current.length = 0
                    current.begin = Date.now()
                }

                current.writer.write(buffer)

                current.length++
                current.silence = 0

                return
            }

            console.log("SKIPPING: " + max)

            if (!current.length) return

            current.silence++

            if (!current.writer) return

            if ((current.silence < 10 && (
                current.length < 2 ||
                (current.length < 10 && current.silence < 2)
            ))) return

            if (current.silence >= current.length * 10) return

            console.log(`RECORDED: ${current.length} samples`)

            current.writer.write(buffer)

            current.writer?.end()
            current.writer = undefined
            current.length = 0
            current.silence = 0

            transcribe(current.path!).then(transcript => {
                if (!transcript ||
                    !transcript.match(/[a-zA-Z]/) ||
                    transcript.includes("*")
                ) return

                console.log(`TRANSCRIBED: ${transcript}`)

                inference(transcript, current.topics).then(response => {
                    console.log(`RESPONSE: ${response}`)
                    ws.send(JSON.stringify([1, response, current.begin]))
                })

                ws.send(JSON.stringify([0, transcript, current.begin]))
            })

            current.path = undefined
        }
    },
    async fetch(request, server) {
        server.upgrade(request, { data: randomUUIDv7() })
        return new Response("Unable to establish a connection.")
    }
})

const prompt = `You are tasked with evaluating a transcript of a presentation, provided in sequential chunks. Your task is to identify and return the numbers of points from the list below that are fully discussed. A point is considered fully discussed if all the following criteria are met:
- Explicit Reference: The point is clearly identified using relevant key terms, events, or ideas 
- Coherent Discussion: The point is discussed in a clear, coherent sentence or phrase, without ambiguity.
- Contextual Confirmation: Consider minor transcription errors (e.g., homophones, slight misinterpretations) and use surrounding context to confirm whether the point is being referenced.

Important Notes:
- Return the numbers of all fully discussed points, separated by spaces.
- If no point is fully covered, return "!" (do not include any additional characters).
- Avoid marking false positives: ensure the reference and discussion are clear and unmistakable.
- Do not return anything other than numbers, spaces, or exclamation marks.

The numbered points are:
`