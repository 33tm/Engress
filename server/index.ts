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
    const transcript = await $`whisper/build/bin/whisper-cli -f ${resolve(filename)} -m whisper/models/ggml-${process.env.MODEL}.bin -np -nt`
        .quiet()
        .text()

    file(filename).delete()

    return transcript.trim()
}

async function inference(input: string, topics: string[]) {
    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        max_tokens: topics.length * 2,
        messages: [
            {
                role: "system",
                content: prompt(topics)
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

            if (current.length < 2 && current.silence < 5) return

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

const prompt = (topics: string[]) => `Evaluate a transcript from a presentation, provided in sequential chunks, to determine which topics are fully discussed according to given criteria.

- Identify any topic that meets all the criteria listed below as fully discussed:
  1. **Explicit Reference**: The topic is somewhat identified using relevant key terms, events, or ideas.
  2. **Coherent Discussion**: The topic is discussed in a clear, coherent sentence or phrase, without ambiguity.
  3. **Contextual Confirmation**: Consider minor transcription errors (e.g., homophones, slight misinterpretations) and use surrounding context to verify if the topic is referenced.
  4. **User Generation**: Keep in mind that topics are user generated, so their meanings may deviate slightly from their actual definition.

# Steps

1. Review each chunk in sequence to identify references to numbered topics.
2. For each reference, check if it meets the criteria for Explicit Reference, Coherent Discussion, and Contextual Confirmation.
3. Compile a list of numbers corresponding to topics that are fully discussed.
4. If no topic is fully covered, indicate with "!".
5. Ensure no false positives; references and discussions must be clear and unmistakable.

# Output Format

- Return the numbers of all fully discussed topics separated by spaces.
- If no topic is fully covered, return only "!" with no additional characters.
- Do not return anything other than numbers, spaces, or an exclamation mark.

# The Topics Numbered

${topics.map((point, index) => `${index + 1}. ${point}`).join("\n")}

# Notes

- Accuracy is crucial; avoid marking points unless all criteria are unequivocally met.
- Pay attention to the context to correct any minor transcription errors.`