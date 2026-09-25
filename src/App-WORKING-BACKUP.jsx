import { useEffect, useRef, useState } from 'react'
import {
  Tldraw,
  toRichText,
  createShapeId,
} from 'tldraw'
import 'tldraw/tldraw.css'
import {
  GoogleGenAI,
  Modality,
} from '@google/genai'


/*
=========================================================
MACALLIN AI MATH
Gemini Live + controlled teaching whiteboard
=========================================================
*/


const whiteboardTools = [
  {
    functionDeclarations: [
      {
        name: 'startMathProblem',

        description:
          'Start a new mathematics problem on the tutoring whiteboard. Use this exactly once before teaching a new problem. It clears previous AI-written mathematics and writes the original problem as the first visible line.',

        parametersJsonSchema: {
          type: 'object',

          properties: {
            problem: {
              type: 'string',

              description:
                'The exact original mathematics problem. Example: 4x + 7 = 31',
            },
          },

          required: ['problem'],
        },
      },

      {
        name: 'writeMathStep',

        description:
          'Write exactly one new mathematical working line below the previous line. Use one call for one visible algebraic transformation. Never combine multiple working lines into one call.',

        parametersJsonSchema: {
          type: 'object',

          properties: {
            text: {
              type: 'string',

              description:
                'Exactly one mathematical working line. Example: 4x + 7 - 7 = 31 - 7',
            },
          },

          required: ['text'],
        },
      },
    ],
  },
]


/*
=========================================================
PAINT HELPER
=========================================================
*/

function waitForBrowserPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve)
    })
  })
}


/*
=========================================================
APP
=========================================================
*/

function App() {
  const [status, setStatus] =
    useState('Not connected')

  const [connected, setConnected] =
    useState(false)

  const [listening, setListening] =
    useState(false)

  const [reconnecting, setReconnecting] =
    useState(false)

  const [
    checkpointReady,
    setCheckpointReady,
  ] = useState(false)


  /*
  =======================================================
  WHITEBOARD
  =======================================================
  */

  const editorRef = useRef(null)

  const aiShapeIdsRef =
    useRef([])

  const nextWhiteboardYRef =
    useRef(230)

  const stepNumberRef =
    useRef(0)

  /*
   * Every whiteboard operation passes through
   * this Promise queue.
   *
   * This prevents separate Gemini messages from
   * drawing at the same time or at the same Y position.
   */

  const whiteboardQueueRef =
    useRef(Promise.resolve())


  function handleEditorMount(editor) {
    editorRef.current = editor
  }


  function queueWhiteboardAction(action) {
    const next =
      whiteboardQueueRef.current
        .catch(() => {})
        .then(action)

    whiteboardQueueRef.current = next

    return next
  }


  /*
  -------------------------------------------------------
  DELETE ONLY GEMINI-CREATED MATH
  -------------------------------------------------------
  */

  async function clearAiMath() {
    const editor =
      editorRef.current

    if (!editor) {
      throw new Error(
        'Whiteboard editor is not ready'
      )
    }

    const ids =
      aiShapeIdsRef.current.filter(
        (id) => editor.getShape(id)
      )

    if (ids.length) {
      editor.deleteShapes(ids)
    }

    aiShapeIdsRef.current = []

    nextWhiteboardYRef.current =
      230

    stepNumberRef.current =
      0

    await waitForBrowserPaint()
  }


  /*
  -------------------------------------------------------
  CREATE ONE AI TEXT SHAPE
  -------------------------------------------------------
  */

  async function createMathText(
    text,
    y
  ) {
    const editor =
      editorRef.current

    if (!editor) {
      throw new Error(
        'Whiteboard editor is not ready'
      )
    }

    const cleanText =
      String(text || '').trim()

    if (!cleanText) {
      throw new Error(
        'Cannot write empty mathematics'
      )
    }

    const id =
      createShapeId()

    editor.createShape({
      id,

      type: 'text',

      x: 240,

      y,

      props: {
        richText:
          toRichText(cleanText),

        size: 'xl',
      },
    })

    aiShapeIdsRef.current.push(id)

    /*
     * Give Tldraw and Chrome two paint frames
     * before Gemini receives confirmation.
     */

    await waitForBrowserPaint()

    return {
      id,
      text: cleanText,
      y,
    }
  }


  /*
  -------------------------------------------------------
  START A NEW PROBLEM
  -------------------------------------------------------
  */

  function startMathProblem(
    args = {}
  ) {
    return queueWhiteboardAction(
      async () => {
        const problem =
          String(
            args.problem || ''
          ).trim()

        if (!problem) {
          throw new Error(
            'No mathematics problem supplied'
          )
        }

        /*
         * Remove previous Gemini mathematics.
         *
         * Any drawings made manually by the
         * human coach remain on the board.
         */

        await clearAiMath()

        const result =
          await createMathText(
            problem,
            120
          )

        nextWhiteboardYRef.current =
          230

        stepNumberRef.current =
          0

        console.log(
          '📘 NEW MATH PROBLEM:',
          problem
        )

        return {
          status: 'success',
          problem:
            result.text,
          visible: true,
        }
      }
    )
  }


  /*
  -------------------------------------------------------
  WRITE ONE WORKING STEP
  -------------------------------------------------------
  */

  function writeMathStep(
    args = {}
  ) {
    return queueWhiteboardAction(
      async () => {
        const text =
          String(
            args.text || ''
          ).trim()

        if (!text) {
          throw new Error(
            'Whiteboard step is empty'
          )
        }

        const stepNumber =
          stepNumberRef.current +
          1

        const y =
          nextWhiteboardYRef.current

        const result =
          await createMathText(
            text,
            y
          )

        stepNumberRef.current =
          stepNumber

        nextWhiteboardYRef.current =
          y + 105

        console.log(
          `✅ WHITEBOARD STEP ${stepNumber}:`,
          text
        )

        return {
          status: 'success',

          stepNumber,

          text:
            result.text,

          visible: true,
        }
      }
    )
  }


  /*
  -------------------------------------------------------
  SAFE DIRECT WHITEBOARD TEST
  -------------------------------------------------------
  */

  async function testWhiteboard() {
    try {
      await startMathProblem({
        problem:
          '3x + 5 = 20',
      })

      const result =
        await writeMathStep({
          text:
            '3x + 5 - 5 = 20 - 5',
        })

      setStatus(
        `Whiteboard test successful: ${result.text}`
      )
    } catch (error) {
      console.error(
        'Whiteboard test failed:',
        error
      )

      setStatus(
        `Whiteboard test failed: ${
          error?.message ||
          'Unknown error'
        }`
      )
    }
  }


  /*
  =======================================================
  GEMINI SESSION REFERENCES
  =======================================================
  */

  const sessionRef =
    useRef(null)

  const sessionHandleRef =
    useRef(null)

  const tokenRef =
    useRef(null)

  const manualDisconnectRef =
    useRef(false)

  const reconnectingRef =
    useRef(false)

  const shouldListenRef =
    useRef(false)

  const connectionSerialRef =
    useRef(0)

  const activeConnectionRef =
    useRef(0)


  /*
  =======================================================
  MICROPHONE REFERENCES
  =======================================================
  */

  const micStreamRef =
    useRef(null)

  const micContextRef =
    useRef(null)

  const micSourceRef =
    useRef(null)

  const micProcessorRef =
    useRef(null)


  /*
  =======================================================
  GEMINI AUDIO OUTPUT
  =======================================================
  */

  const outputContextRef =
    useRef(null)

  const nextAudioTimeRef =
    useRef(0)

  const playingSourcesRef =
    useRef([])


  /*
  =======================================================
  AUDIO CONVERSION
  =======================================================
  */

  function bytesToBase64(
    bytes
  ) {
    let binary = ''

    const chunkSize =
      0x8000

    for (
      let i = 0;
      i < bytes.length;
      i += chunkSize
    ) {
      const chunk =
        bytes.subarray(
          i,
          Math.min(
            i + chunkSize,
            bytes.length
          )
        )

      binary +=
        String.fromCharCode(
          ...chunk
        )
    }

    return btoa(binary)
  }


  function float32ToPcm16Base64(
    float32Array
  ) {
    const pcm16 =
      new Int16Array(
        float32Array.length
      )

    for (
      let i = 0;
      i <
      float32Array.length;
      i++
    ) {
      const sample =
        Math.max(
          -1,
          Math.min(
            1,
            float32Array[i]
          )
        )

      pcm16[i] =
        sample < 0
          ? sample *
            0x8000
          : sample *
            0x7fff
    }

    return bytesToBase64(
      new Uint8Array(
        pcm16.buffer
      )
    )
  }


  function base64ToInt16(
    base64
  ) {
    const binary =
      atob(base64)

    const bytes =
      new Uint8Array(
        binary.length
      )

    for (
      let i = 0;
      i < binary.length;
      i++
    ) {
      bytes[i] =
        binary.charCodeAt(i)
    }

    return new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(
        bytes.byteLength / 2
      )
    )
  }


  /*
  =======================================================
  GEMINI AUDIO PLAYBACK
  =======================================================
  */

  async function getOutputContext() {
    if (
      !outputContextRef.current
    ) {
      outputContextRef.current =
        new AudioContext({
          sampleRate: 24000,
        })
    }

    if (
      outputContextRef.current
        .state ===
      'suspended'
    ) {
      await outputContextRef
        .current
        .resume()
    }

    return outputContextRef
      .current
  }


  async function playAudioChunk(
    base64Audio
  ) {
    const audioContext =
      await getOutputContext()

    const pcm16 =
      base64ToInt16(
        base64Audio
      )

    if (!pcm16.length) {
      return
    }

    const audioBuffer =
      audioContext.createBuffer(
        1,
        pcm16.length,
        24000
      )

    const channel =
      audioBuffer
        .getChannelData(0)

    for (
      let i = 0;
      i < pcm16.length;
      i++
    ) {
      channel[i] =
        pcm16[i] /
        32768
    }

    const source =
      audioContext
        .createBufferSource()

    source.buffer =
      audioBuffer

    source.connect(
      audioContext.destination
    )

    const startTime =
      Math.max(
        audioContext
          .currentTime,
        nextAudioTimeRef
          .current
      )

    source.start(startTime)

    nextAudioTimeRef.current =
      startTime +
      audioBuffer.duration

    playingSourcesRef.current
      .push(source)

    source.onended =
      () => {
        playingSourcesRef.current =
          playingSourcesRef
            .current
            .filter(
              (item) =>
                item !== source
            )
      }
  }


  function stopGeminiAudio() {
    for (
      const source
      of playingSourcesRef
        .current
    ) {
      try {
        source.stop()
      } catch {}
    }

    playingSourcesRef.current = []

    if (
      outputContextRef.current
    ) {
      nextAudioTimeRef.current =
        outputContextRef
          .current
          .currentTime
    }
  }


  /*
  =======================================================
  MICROPHONE STREAM CONTROL
  =======================================================
  */

  function stopSendingMicrophoneAudio() {
    if (
      micProcessorRef.current
    ) {
      micProcessorRef
        .current
        .onaudioprocess =
        null
    }
  }


  function resumeSendingMicrophoneAudio() {
    const processor =
      micProcessorRef.current

    if (!processor) {
      return
    }

    processor.onaudioprocess =
      (event) => {
        const session =
          sessionRef.current

        if (
          !session ||
          reconnectingRef.current
        ) {
          return
        }

        const input =
          event.inputBuffer
            .getChannelData(0)

        const base64Audio =
          float32ToPcm16Base64(
            input
          )

        try {
          session
            .sendRealtimeInput({
              audio: {
                data:
                  base64Audio,

                mimeType:
                  `audio/pcm;rate=${
                    micContextRef
                      .current
                      .sampleRate
                  }`,
              },
            })
        } catch (error) {
          console.error(
            'Microphone send error:',
            error
          )
        }
      }
  }


  /*
  =======================================================
  SECURE TOKEN
  =======================================================
  */

  async function getSecureToken() {
    const response =
      await fetch(
        'http://localhost:3001/token',
        {
          cache: 'no-store',
        }
      )

    if (!response.ok) {
      const text =
        await response.text()

      throw new Error(
        `Token server returned ${
          response.status
        }: ${text}`
      )
    }

    const data =
      await response.json()

    if (!data.token) {
      throw new Error(
        'Token server did not return a token'
      )
    }

    return data.token
  }


  /*
  =======================================================
  SESSION RESUMPTION
  =======================================================
  */

  async function resumeGeminiSession(
    handle
  ) {
    if (
      manualDisconnectRef.current ||
      reconnectingRef.current
    ) {
      return
    }

    reconnectingRef.current = true

    setReconnecting(true)
    setConnected(false)

    stopSendingMicrophoneAudio()

    setStatus(
      'Connection changed — resuming Gemini session...'
    )

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          500
        )
    )

    try {
      await openGeminiSession({
        resumeHandle:
          handle,

        isReconnect:
          true,
      })
    } catch (error) {
      console.error(
        'Session resumption failed:',
        error
      )

      reconnectingRef.current =
        false

      setReconnecting(false)
      setConnected(false)
      setListening(false)

      setStatus(
        `Session resumption failed: ${
          error?.message ||
          'Unknown error'
        }`
      )
    }
  }


  /*
  =======================================================
  OPEN GEMINI LIVE SESSION
  =======================================================
  */

  async function openGeminiSession({
    resumeHandle = null,
    isReconnect = false,
  } = {}) {
    if (!tokenRef.current) {
      tokenRef.current =
        await getSecureToken()
    }

    const ai =
      new GoogleGenAI({
        apiKey:
          tokenRef.current,

        apiVersion:
          'v1beta',
      })

    const connectionId =
      ++connectionSerialRef
        .current

    activeConnectionRef.current =
      connectionId


    const callbacks = {
      onopen: () => {
        console.log(
          isReconnect
            ? 'Gemini socket opened for session resumption'
            : 'Gemini socket opened'
        )
      },


      onmessage:
        async (message) => {
          if (
            connectionId !==
            activeConnectionRef
              .current
          ) {
            return
          }


          console.log(
            '========== GEMINI LIVE MESSAGE =========='
          )

          console.log(message)


          /*
          -------------------------------------------------
          GEMINI TOOL CALLS
          -------------------------------------------------
          */

          const functionCalls =
            message.toolCall
              ?.functionCalls ||
            []


          if (
            functionCalls.length
          ) {
            const functionResponses =
              []


            for (
              const functionCall
              of functionCalls
            ) {
              try {
                let result


                if (
                  functionCall.name ===
                  'startMathProblem'
                ) {
                  result =
                    await startMathProblem(
                      functionCall.args ||
                        {}
                    )

                  setStatus(
                    `New problem: ${result.problem}`
                  )
                }


                else if (
                  functionCall.name ===
                  'writeMathStep'
                ) {
                  result =
                    await writeMathStep(
                      functionCall.args ||
                        {}
                    )

                  setStatus(
                    `Step ${result.stepNumber}: ${result.text}`
                  )
                }


                else {
                  throw new Error(
                    `Unknown tool: ${functionCall.name}`
                  )
                }


                functionResponses.push({
                  id:
                    functionCall.id,

                  name:
                    functionCall.name,

                  response: {
                    result:
                      'The requested mathematics is now visible on the whiteboard',

                    ...result,
                  },
                })
              }


              catch (error) {
                console.error(
                  'Whiteboard tool failed:',
                  error
                )

                functionResponses.push({
                  id:
                    functionCall.id,

                  name:
                    functionCall.name,

                  response: {
                    error:
                      error?.message ||
                      'Whiteboard action failed',
                  },
                })
              }
            }


            /*
             * Gemini receives confirmation only
             * AFTER the queued Tldraw action has
             * actually painted.
             */

            if (
              sessionRef.current &&
              functionResponses.length
            ) {
              sessionRef.current
                .sendToolResponse({
                  functionResponses,
                })
            }
          }


          /*
          -------------------------------------------------
          SESSION CHECKPOINT
          -------------------------------------------------
          */

          const resumptionUpdate =
            message
              .sessionResumptionUpdate

          if (
            resumptionUpdate
              ?.resumable &&
            resumptionUpdate
              ?.newHandle
          ) {
            sessionHandleRef.current =
              resumptionUpdate
                .newHandle

            setCheckpointReady(true)

            console.log(
              'Session resumption checkpoint saved'
            )
          }


          /*
          -------------------------------------------------
          CONNECTION ROTATION
          -------------------------------------------------
          */

          if (message.goAway) {
            console.log(
              'Gemini GoAway received:',
              message.goAway
            )

            setStatus(
              'Gemini preparing safe connection handoff...'
            )
          }


          const content =
            message.serverContent


          /*
          -------------------------------------------------
          TRANSCRIPTS
          -------------------------------------------------
          */

          if (
            content
              ?.inputTranscription
              ?.text
          ) {
            console.log(
              'Student:',
              content
                .inputTranscription
                .text
            )
          }


          if (
            content
              ?.outputTranscription
              ?.text
          ) {
            console.log(
              'Gemini:',
              content
                .outputTranscription
                .text
            )
          }


          /*
          -------------------------------------------------
          INTERRUPTION
          -------------------------------------------------
          */

          if (
            content?.interrupted
          ) {
            stopGeminiAudio()
          }


          /*
          -------------------------------------------------
          AUDIO
          -------------------------------------------------
          */

          const parts =
            content
              ?.modelTurn
              ?.parts ||
            []

          for (
            const part
            of parts
          ) {
            const inlineData =
              part.inlineData

            if (
              inlineData?.data &&
              inlineData
                ?.mimeType
                ?.startsWith(
                  'audio/'
                )
            ) {
              await playAudioChunk(
                inlineData.data
              )
            }
          }


          /*
          -------------------------------------------------
          TURN COMPLETE
          -------------------------------------------------
          */

          if (
            content?.turnComplete
          ) {
            setStatus(
              shouldListenRef
                .current
                ? 'Listening — speak to Gemini'
                : 'Gemini Live connected'
            )
          }
        },


      onerror:
        (error) => {
          console.error(
            'Gemini Live error:',
            error
          )

          setStatus(
            'Gemini connection event detected...'
          )
        },


      onclose:
        (event) => {
          console.log(
            'Gemini Live closed:',
            event
          )

          if (
            connectionId !==
            activeConnectionRef
              .current
          ) {
            return
          }

          sessionRef.current =
            null

          setConnected(false)

          stopSendingMicrophoneAudio()


          if (
            manualDisconnectRef
              .current
          ) {
            reconnectingRef.current =
              false

            setReconnecting(false)
            setListening(false)

            setStatus(
              'Disconnected'
            )

            return
          }


          const handle =
            sessionHandleRef.current

          if (!handle) {
            reconnectingRef.current =
              false

            setReconnecting(false)
            setListening(false)

            setStatus(
              'Gemini connection closed. No session checkpoint available.'
            )

            return
          }

          resumeGeminiSession(
            handle
          )
        },
    }


    /*
    =====================================================
    LIVE CONFIG
    =====================================================
    */

    const newSession =
      await ai.live.connect({
        model:
          'gemini-3.1-flash-live-preview',

        config: {
          responseModalities: [
            Modality.AUDIO,
          ],

          tools:
            whiteboardTools,

          inputAudioTranscription:
            {},

          outputAudioTranscription:
            {},

          contextWindowCompression: {
            slidingWindow: {},
          },

          sessionResumption:
            resumeHandle
              ? {
                  handle:
                    resumeHandle,
                }
              : {},


          /*
          ===============================================
          MACALLIN TEACHING PROTOCOL
          ===============================================
          */

          systemInstruction: {
            parts: [
              {
                text:
`You are Macallin AI Math Teacher.

You are teaching a student live while a human coach supervises.

The learner hears your voice and sees a digital mathematics whiteboard.

You have TWO real whiteboard functions:

1. startMathProblem
2. writeMathStep


==================================================
NEW PROBLEM RULE
==================================================

Whenever the learner, coach, lesson document, or conversation introduces a NEW mathematics problem:

FIRST call startMathProblem with the exact original problem.

Do this BEFORE doing any algebra.

Example:

Student says:

"Teach me 4x + 7 = 31."

Your first whiteboard action must be:

startMathProblem({
  problem: "4x + 7 = 31"
})

Never begin with the second line of working.

The original question itself must always be visible.


==================================================
ONE VISIBLE TRANSFORMATION AT A TIME
==================================================

After the original problem is visible, use writeMathStep for EVERY meaningful mathematical transformation.

One tool call = one visible mathematical line.

Never put two algebra steps inside one whiteboard call.

Never perform an invisible calculation.


==================================================
BALANCING EQUATIONS
==================================================

When performing an operation on an equation, explicitly show that same operation on BOTH SIDES before simplifying.

For:

4x + 7 = 31

do NOT jump directly to:

4x = 24

Instead write:

4x + 7 - 7 = 31 - 7

Then write:

4x = 24


==================================================
DIVISION
==================================================

Do not jump directly from:

4x = 24

to:

x = 6

First write:

4x / 4 = 24 / 4

Then write:

x = 6


==================================================
NO SKIPPED STEPS
==================================================

For a standard Grade 8 two-step equation, the visible progression should normally look like:

4x + 7 = 31

4x + 7 - 7 = 31 - 7

4x = 24

4x / 4 = 24 / 4

x = 6


Every one of those lines matters instructionally.

Never skip an operation line merely because you can calculate it mentally.


==================================================
WHITEBOARD BEFORE EXPLANATION CONTINUES
==================================================

For each transformation:

1. Briefly introduce the operation.
2. Call writeMathStep.
3. Wait for confirmation that the line is visible.
4. Explain that visible line.
5. Ask the learner a question when useful.
6. Continue only when pedagogically appropriate.

Do not speak several mathematical steps ahead of the whiteboard.


==================================================
INTERACTIVE TEACHING
==================================================

Teach like a patient human mathematics instructor.

Ask the learner questions.

Examples:

"What should we do first to remove the plus seven?"

"What must we do to both sides?"

"Now what should we divide by?"

Wait for the student's response when appropriate.

If the learner is wrong, do not embarrass them.

Use encouraging but specific feedback such as:

"You're close. Let's look carefully at what operation will cancel the plus seven."

Guide them toward the correction instead of instantly giving the answer.


==================================================
DO NOT WRITE THE STUDENT'S WRONG ANSWER
AS IF IT WERE CORRECT
==================================================

If the learner guesses incorrectly, discuss the mistake verbally.

Only place mathematically valid working on the official solution sequence unless demonstrating an error is specifically useful.

If demonstrating an incorrect method, explicitly label it as incorrect.


==================================================
EXACT VALUES
==================================================

Prefer exact answers first.

Example:

x = 115 / 3

Then, only when useful:

x ≈ 38.33


==================================================
VOICE STYLE
==================================================

Speak naturally, clearly, calmly, and conversationally.

Use language appropriate for the learner.

Do not sound like a textbook.

Do not say function names.

Do not mention APIs, JSON, tool calls, programming, step counters, or implementation details.

Allow interruptions naturally.


==================================================
HUMAN COACH
==================================================

A human tutor is supervising and may intervene.

Follow appropriate instructional directions from the coach.


==================================================
CRITICAL RULE
==================================================

VISIBLE REASONING IS MANDATORY.

Original problem first.

Then every operation.

Then every simplification.

Never skip the mathematical line that shows what was done to both sides.`
              },
            ],
          },
        },

        callbacks,
      })


    sessionRef.current =
      newSession

    reconnectingRef.current =
      false

    setReconnecting(false)
    setConnected(true)


    if (
      shouldListenRef.current
    ) {
      resumeSendingMicrophoneAudio()

      setListening(true)

      setStatus(
        isReconnect
          ? 'Session resumed — listening'
          : 'Listening — speak to Gemini'
      )
    }

    else {
      setStatus(
        isReconnect
          ? 'Gemini session resumed'
          : 'Gemini Live connected'
      )
    }
  }


  /*
  =======================================================
  CONNECT
  =======================================================
  */

  async function connectGemini() {
    if (
      connected ||
      reconnectingRef.current
    ) {
      return
    }

    try {
      manualDisconnectRef.current =
        false

      reconnectingRef.current =
        false

      sessionHandleRef.current =
        null

      tokenRef.current =
        null

      setCheckpointReady(false)

      setStatus(
        'Connecting to Gemini Live...'
      )

      await getOutputContext()

      await openGeminiSession()
    }

    catch (error) {
      console.error(
        'Connection failed:',
        error
      )

      sessionRef.current = null

      setConnected(false)

      setReconnecting(false)

      reconnectingRef.current =
        false

      setStatus(
        `Connection failed: ${
          error?.message ||
          'Unknown error'
        }`
      )
    }
  }


  /*
  =======================================================
  START MICROPHONE
  =======================================================
  */

  async function startMicrophone() {
    const session =
      sessionRef.current

    if (
      !session ||
      !connected
    ) {
      setStatus(
        'Connect Gemini first'
      )

      return
    }

    if (listening) {
      return
    }

    try {
      const stream =
        await navigator
          .mediaDevices
          .getUserMedia({
            audio: {
              echoCancellation:
                true,

              noiseSuppression:
                true,

              autoGainControl:
                true,
            },
          })

      micStreamRef.current =
        stream

      const audioContext =
        new AudioContext()

      micContextRef.current =
        audioContext

      if (
        audioContext.state ===
        'suspended'
      ) {
        await audioContext
          .resume()
      }

      const source =
        audioContext
          .createMediaStreamSource(
            stream
          )

      micSourceRef.current =
        source

      const processor =
        audioContext
          .createScriptProcessor(
            4096,
            1,
            1
          )

      micProcessorRef.current =
        processor

      source.connect(processor)

      processor.connect(
        audioContext.destination
      )

      shouldListenRef.current =
        true

      resumeSendingMicrophoneAudio()

      setListening(true)

      setStatus(
        'Listening — speak to Gemini'
      )
    }

    catch (error) {
      console.error(
        'Microphone failed:',
        error
      )

      setStatus(
        `Microphone failed: ${
          error?.message ||
          'Unknown error'
        }`
      )
    }
  }


  /*
  =======================================================
  STOP MICROPHONE
  =======================================================
  */

  async function stopMicrophone() {
    shouldListenRef.current =
      false

    stopSendingMicrophoneAudio()

    if (
      sessionRef.current &&
      !reconnectingRef.current
    ) {
      try {
        sessionRef.current
          .sendRealtimeInput({
            audioStreamEnd:
              true,
          })
      } catch {}
    }

    if (
      micProcessorRef.current
    ) {
      try {
        micProcessorRef
          .current
          .disconnect()
      } catch {}

      micProcessorRef.current =
        null
    }

    if (
      micSourceRef.current
    ) {
      try {
        micSourceRef.current
          .disconnect()
      } catch {}

      micSourceRef.current =
        null
    }

    if (
      micStreamRef.current
    ) {
      for (
        const track
        of micStreamRef
          .current
          .getTracks()
      ) {
        track.stop()
      }

      micStreamRef.current =
        null
    }

    if (
      micContextRef.current
    ) {
      try {
        await micContextRef
          .current
          .close()
      } catch {}

      micContextRef.current =
        null
    }

    setListening(false)

    if (connected) {
      setStatus(
        'Microphone stopped — Gemini still connected'
      )
    }
  }


  /*
  =======================================================
  DISCONNECT
  =======================================================
  */

  async function disconnectGemini() {
    manualDisconnectRef.current =
      true

    shouldListenRef.current =
      false

    stopSendingMicrophoneAudio()

    stopGeminiAudio()

    if (
      micProcessorRef.current
    ) {
      try {
        micProcessorRef.current
          .disconnect()
      } catch {}

      micProcessorRef.current =
        null
    }

    if (
      micSourceRef.current
    ) {
      try {
        micSourceRef.current
          .disconnect()
      } catch {}

      micSourceRef.current =
        null
    }

    if (
      micStreamRef.current
    ) {
      for (
        const track
        of micStreamRef
          .current
          .getTracks()
      ) {
        track.stop()
      }

      micStreamRef.current =
        null
    }

    if (
      micContextRef.current
    ) {
      try {
        await micContextRef
          .current
          .close()
      } catch {}

      micContextRef.current =
        null
    }

    if (
      sessionRef.current
    ) {
      try {
        sessionRef.current
          .close()
      } catch {}

      sessionRef.current =
        null
    }

    setListening(false)
    setConnected(false)
    setReconnecting(false)

    reconnectingRef.current =
      false

    sessionHandleRef.current =
      null

    tokenRef.current =
      null

    setCheckpointReady(false)

    setStatus(
      'Disconnected'
    )
  }


  /*
  =======================================================
  CLEANUP
  =======================================================
  */

  useEffect(() => {
    return () => {
      manualDisconnectRef.current =
        true

      shouldListenRef.current =
        false

      if (
        micStreamRef.current
      ) {
        for (
          const track
          of micStreamRef
            .current
            .getTracks()
        ) {
          track.stop()
        }
      }

      if (
        sessionRef.current
      ) {
        try {
          sessionRef.current
            .close()
        } catch {}
      }

      for (
        const source
        of playingSourcesRef
          .current
      ) {
        try {
          source.stop()
        } catch {}
      }
    }
  }, [])


  /*
  =======================================================
  UI
  =======================================================
  */

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
      }}
    >
      <Tldraw
        onMount={
          handleEditorMount
        }
      />


      <div
        style={{
          position: 'fixed',

          top: 20,
          right: 20,

          zIndex: 1000,

          width: 300,

          background: 'white',

          padding: 14,

          borderRadius: 12,

          boxShadow:
            '0 2px 12px rgba(0,0,0,0.2)',

          fontFamily: 'Arial',
        }}
      >
        <button
          onClick={
            connectGemini
          }

          disabled={
            connected ||
            reconnecting
          }

          style={{
            width: '100%',
            padding:
              '10px 12px',
            fontSize: 15,
          }}
        >
          {
            reconnecting
              ? 'Resuming Gemini...'
              : connected
                ? 'Gemini Connected'
                : 'Connect Gemini'
          }
        </button>


        <button
          onClick={
            startMicrophone
          }

          disabled={
            !connected ||
            listening ||
            reconnecting
          }

          style={{
            width: '100%',
            marginTop: 8,
            padding:
              '10px 12px',
            fontSize: 15,
          }}
        >
          Start Microphone
        </button>


        <button
          onClick={
            stopMicrophone
          }

          disabled={!listening}

          style={{
            width: '100%',
            marginTop: 8,
            padding:
              '10px 12px',
            fontSize: 15,
          }}
        >
          Stop Microphone
        </button>


        <button
          onClick={
            testWhiteboard
          }

          style={{
            width: '100%',
            marginTop: 8,
            padding:
              '10px 12px',
            fontSize: 15,
          }}
        >
          Test Whiteboard
        </button>


        <button
          onClick={
            disconnectGemini
          }

          disabled={
            !connected &&
            !reconnecting
          }

          style={{
            width: '100%',
            marginTop: 8,
            padding:
              '10px 12px',
            fontSize: 15,
          }}
        >
          Disconnect Gemini
        </button>


        <div
          style={{
            marginTop: 10,
            fontSize: 14,
            lineHeight: 1.4,
          }}
        >
          {status}
        </div>


        {
          checkpointReady &&
          (
            <div
              style={{
                marginTop: 7,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ✓ Session checkpoint ready
            </div>
          )
        }
      </div>
    </div>
  )
}


export default App