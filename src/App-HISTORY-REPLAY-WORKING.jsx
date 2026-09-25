import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import {
  Tldraw,
  toRichText,
  createShapeId,
} from 'tldraw'
import 'tldraw/tldraw.css'


/*
=========================================================
MACALLIN AI MATH
OpenAI Realtime + Whiteboard + Lesson Sources
=========================================================
*/


const API_BASE =
  import.meta.env.VITE_API_BASE ||
  'http://localhost:3001'


/*
=========================================================
WHITEBOARD TOOLS
=========================================================
*/

const whiteboardTools = [
  {
    type: 'function',

    name: 'startMathProblem',

    description:
      'Start a new mathematics problem on the tutoring whiteboard. Use this once before teaching each new problem. It clears previous AI-written mathematics and writes the exact original problem as the first visible line.',

    parameters: {
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
    type: 'function',

    name: 'writeMathStep',

    description:
      'Write exactly one new mathematical working line below the previous visible line. Every meaningful mathematical operation must be visible. Show the same operation on both sides of an equation when solving algebra.',

    parameters: {
      type: 'object',

      properties: {
        text: {
          type: 'string',

          description:
            'Exactly one complete mathematical working line. Example: 4x + 7 - 7 = 31 - 7',
        },
      },

      required: ['text'],
    },
  },
]



/*
=========================================================
HELPERS
=========================================================
*/

function waitForBrowserPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve)
    })
  })
}


function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () =>
      resolve(reader.result)

    reader.onerror = () =>
      reject(
        new Error(
          'Could not read the selected file'
        )
      )

    reader.readAsDataURL(file)
  })
}


function dataUrlToBase64(dataUrl) {
  const comma = dataUrl.indexOf(',')

  if (comma === -1) {
    return dataUrl
  }

  return dataUrl.slice(comma + 1)
}


function cleanLessonText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
}


/*
=========================================================
APP
=========================================================
*/

function App() {
  /*
  =======================================================
  UI STATE
  =======================================================
  */

  const [status, setStatus] =
    useState('Not connected')

  const [connected, setConnected] =
    useState(false)

  const [listening, setListening] =
    useState(false)

  const [reconnecting, setReconnecting] =
    useState(false)

  const [checkpointReady, setCheckpointReady] =
    useState(false)

  const [studentName, setStudentName] =
    useState('')

  const [gradeLevel, setGradeLevel] =
    useState('')

  const [lessonTitle, setLessonTitle] =
    useState('')

  const [lessonFile, setLessonFile] =
    useState(null)

  const [
    manualLessonText,
    setManualLessonText,
  ] = useState('')

  const [
    preparedLesson,
    setPreparedLesson,
  ] = useState(null)

  const [
    lessonStatus,
    setLessonStatus,
  ] = useState(
    'No lesson prepared'
  )

  const [
    preparingLesson,
    setPreparingLesson,
  ] = useState(false)

  const [
    sendingLesson,
    setSendingLesson,
  ] = useState(false)

  /*
  =======================================================
  CLASSROOM PRESENCE Ã¢â‚¬â€ TEACHER ONLY
  =======================================================
  */

  const searchParams =
    new URLSearchParams(
      window.location.search
    )

  const initialViewMode =
    searchParams.get('view') ===
      'student'
      ? 'student'
      : 'teacher'

  const initialRoomId =
    searchParams.get('room') ||
    'demo-classroom'

  const [roomId] =
    useState(initialRoomId)

  const [
    classroomConnected,
    setClassroomConnected,
  ] = useState(false)

  const [
    studentCount,
    setStudentCount,
  ] = useState(0)

  const [
    teacherPresent,
    setTeacherPresent,
  ] = useState(false)

  const [
    classroomStatus,
    setClassroomStatus,
  ] = useState(
    'Classroom not joined'
  )

  const socketRef =
    useRef(null)

  const applyingRemoteWhiteboardRef =
    useRef(false)


  /*
  =======================================================
  WHITEBOARD
  =======================================================
  */

  const editorRef =
    useRef(null)

  const aiShapeIdsRef =
    useRef([])

  const nextWhiteboardYRef =
    useRef(230)

  const stepNumberRef =
    useRef(0)

  const whiteboardQueueRef =
    useRef(
      Promise.resolve()
    )


  function handleEditorMount(editor) {
    editorRef.current = editor
  }


  function queueWhiteboardAction(action) {
    const next =
      whiteboardQueueRef.current
        .catch(() => {})
        .then(action)

    whiteboardQueueRef.current =
      next

    return next
  }


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
        (id) =>
          editor.getShape(id)
      )

    if (ids.length) {
      editor.deleteShapes(ids)
    }

    aiShapeIdsRef.current = []

    nextWhiteboardYRef.current =
      230

    stepNumberRef.current = 0

    await waitForBrowserPaint()
  }


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

      /*
      IMPORTANT:
      Keep the AI mathematics centered.
      */
      x: 500,

      y,

      props: {
        richText:
          toRichText(cleanText),

        size: 'xl',
      },
    })

    aiShapeIdsRef.current.push(
      id
    )

    await waitForBrowserPaint()

    return {
      id,
      text: cleanText,
      y,
    }
  }


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
          'Ã°Å¸â€œËœ NEW MATH PROBLEM:',
          problem
        )

        if (
          initialViewMode === 'teacher' &&
          !applyingRemoteWhiteboardRef.current &&
          socketRef.current?.connected
        ) {
          socketRef.current.emit(
            'classroom:whiteboard',
            {
              whiteboard: {
                type: 'startMathProblem',
                problem: result.text,
              },
            }
          )
        }

        return {
          status: 'success',
          problem: result.text,
          visible: true,
        }
      }
    )
  }


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
          stepNumberRef.current + 1

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
          `Ã¢Å“â€¦ WHITEBOARD STEP ${stepNumber}:`,
          text
        )

        if (
          initialViewMode === 'teacher' &&
          !applyingRemoteWhiteboardRef.current &&
          socketRef.current?.connected
        ) {
          socketRef.current.emit(
            'classroom:whiteboard',
            {
              whiteboard: {
                type: 'writeMathStep',
                text: result.text,
              },
            }
          )
        }

        return {
          status: 'success',
          stepNumber,
          text: result.text,
          visible: true,
        }
      }
    )
  }


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
    }

    catch (error) {
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
  OPENAI REALTIME REFERENCES
  =======================================================
  */

  const peerConnectionRef =
    useRef(null)

  const dataChannelRef =
    useRef(null)

  const localStreamRef =
    useRef(null)

  const remoteAudioRef =
    useRef(null)

  const manualDisconnectRef =
    useRef(false)

  const shouldListenRef =
    useRef(false)


  /*
  =======================================================
  PREPARE LESSON
  =======================================================
  */

  async function prepareLesson() {
    if (preparingLesson) {
      return
    }

    const typedText =
      cleanLessonText(
        manualLessonText
      )

    if (
      !lessonFile &&
      !typedText
    ) {
      setLessonStatus(
        'Choose a lesson file or paste lesson text first.'
      )

      return
    }

    setPreparingLesson(true)

    try {
      /*
      -----------------------------------------------
      PASTED TEXT
      -----------------------------------------------
      */

      if (typedText) {
        setPreparedLesson({
          sourceType:
            'text',

          title:
            lessonTitle ||
            'Typed lesson',

          fileName:
            null,

          text:
            typedText,

          imageData:
            null,

          imageMimeType:
            null,
        })

        setLessonStatus(
          'Lesson ready Ã¢Å“â€œ Ã¢â‚¬â€ typed text'
        )

        return
      }


      const file =
        lessonFile

      const name =
        file.name.toLowerCase()

      const mime =
        file.type || ''


      /*
      -----------------------------------------------
      IMAGE
      -----------------------------------------------
      */

      if (
        mime.startsWith(
          'image/'
        ) ||
        /\.(jpg|jpeg|png|webp)$/i
          .test(name)
      ) {
        const dataUrl =
          await fileToDataUrl(
            file
          )

        setPreparedLesson({
          sourceType:
            'image',

          title:
            lessonTitle ||
            file.name,

          fileName:
            file.name,

          text:
            '',

          imageData:
            dataUrlToBase64(
              dataUrl
            ),

          imageMimeType:
            mime ||
            'image/jpeg',
        })

        setLessonStatus(
          `Lesson ready Ã¢Å“â€œ Ã¢â‚¬â€ ${file.name}`
        )

        return
      }


      /*
      -----------------------------------------------
      TXT
      -----------------------------------------------
      */

      if (
        mime === 'text/plain' ||
        name.endsWith('.txt')
      ) {
        const text =
          cleanLessonText(
            await file.text()
          )

        setPreparedLesson({
          sourceType:
            'text',

          title:
            lessonTitle ||
            file.name,

          fileName:
            file.name,

          text,

          imageData:
            null,

          imageMimeType:
            null,
        })

        setLessonStatus(
          `Lesson ready Ã¢Å“â€œ Ã¢â‚¬â€ ${file.name}`
        )

        return
      }


      /*
      -----------------------------------------------
      PDF / DOCX
      -----------------------------------------------
      */

      if (
        name.endsWith('.pdf') ||
        name.endsWith('.docx') ||
        mime ===
          'application/pdf' ||
        mime ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        const formData =
          new FormData()

        formData.append(
          'lessonFile',
          file
        )

        const response =
          await fetch(
            `${API_BASE}/prepare-lesson`,
            {
              method: 'POST',
              body: formData,
            }
          )

        if (!response.ok) {
          const errorText =
            await response.text()

          throw new Error(
            `Lesson processor returned ${response.status}: ${errorText}`
          )
        }

        const data =
          await response.json()

        const extractedText =
          cleanLessonText(
            data.text
          )

        if (!extractedText) {
          throw new Error(
            'The document was processed but no readable lesson text was found.'
          )
        }

        setPreparedLesson({
          sourceType:
            data.sourceType ||
            'document',

          title:
            lessonTitle ||
            file.name,

          fileName:
            file.name,

          text:
            extractedText,

          imageData:
            null,

          imageMimeType:
            null,
        })

        setLessonStatus(
          `Lesson ready Ã¢Å“â€œ Ã¢â‚¬â€ ${file.name}`
        )

        return
      }


      throw new Error(
        'Unsupported lesson format. Use JPG, PNG, WEBP, PDF, DOCX, TXT, or pasted text.'
      )
    }

    catch (error) {
      console.error(
        'Prepare lesson failed:',
        error
      )

      setPreparedLesson(null)

      setLessonStatus(
        `Lesson preparation failed: ${
          error?.message ||
          'Unknown error'
        }`
      )
    }

    finally {
      setPreparingLesson(false)
    }
  }


  /*
  =======================================================
  SEND LESSON TO OPENAI
  =======================================================

  Milestone 1 is voice-only. Lesson preparation remains
  fully available, but sending the prepared lesson into
  the Realtime conversation will be enabled after the
  voice connection is proven stable.
  =======================================================
  */

  async function sendLessonToOpenAI() {
    if (!connected) {
      setLessonStatus(
        'Connect OpenAI first.'
      )

      return
    }

    if (!preparedLesson) {
      setLessonStatus(
        'Prepare a lesson first.'
      )

      return
    }

    if (sendingLesson) {
      return
    }

    setSendingLesson(true)

    try {
      const lessonHeader = [
        'MACALLIN LESSON MATERIAL',
        studentName
          ? `Student: ${studentName}`
          : null,
        gradeLevel
          ? `Grade / Level: ${gradeLevel}`
          : null,
        `Lesson title: ${
          preparedLesson.title ||
          lessonTitle ||
          'Untitled lesson'
        }`,
        '',
        'Treat the material below as the primary lesson source for this tutoring session.',
        'Do not begin teaching yet. Store this lesson context and wait for the student or tutor to start the lesson.',
        'When tutoring begins, start at the BEGINNING of this lesson unless the student explicitly asks for another section.',
        'If the student says restart, start over, go back to the beginning, or similar, immediately reset your lesson position to the beginning and teach from there.',
      ]
        .filter(Boolean)
        .join('\n')

      const content = []

      if (preparedLesson.text) {
        content.push({
          type: 'input_text',
          text: `${lessonHeader}\n\nLESSON CONTENT:\n${preparedLesson.text}`,
        })
      } else {
        content.push({
          type: 'input_text',
          text: lessonHeader,
        })
      }

      if (
        preparedLesson.sourceType ===
          'image' &&
        preparedLesson.imageData
      ) {
        const mimeType =
          preparedLesson.imageMimeType ||
          'image/jpeg'

        content.push({
          type: 'input_image',
          image_url: `data:${mimeType};base64,${preparedLesson.imageData}`,
        })
      }

      sendRealtimeEvent({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content,
        },
      })

      setLessonStatus(
        'Lesson sent to OpenAI Ã¢Å“â€œ Ã¢â‚¬â€ ready to begin tutoring'
      )
    }

    catch (error) {
      console.error(
        'Send lesson to OpenAI failed:',
        error
      )

      setLessonStatus(
        `Lesson sending failed: ${
          error?.message ||
          'Unknown error'
        }`
      )
    }

    finally {
      setSendingLesson(false)
    }
  }


  /*
  =======================================================
  CLASSROOM PRESENCE Ã¢â‚¬â€ TEACHER ONLY
  =======================================================

  Presence only. This does NOT share lessons, whiteboard
  state, microphone audio, or OpenAI Realtime state.
  =======================================================
  */

  useEffect(() => {
    const socket =
      io(API_BASE, {
        transports: [
          'websocket',
          'polling',
        ],
      })

    socketRef.current =
      socket

    socket.on(
      'connect',
      () => {
        setClassroomStatus(
          'Classroom server connected Ã¢â‚¬â€ joining room...'
        )

        socket.emit(
          'classroom:join',
          {
            roomId:
              initialRoomId,
            role:
              initialViewMode,
          }
        )
      }
    )

    socket.on(
      'classroom:joined',
      async (payload = {}) => {
        setClassroomConnected(
          true
        )

        setClassroomStatus(
          `Joined classroom: ${
            payload.roomId ||
            initialRoomId
          }`
        )

        if (initialViewMode !== 'student') {
          return
        }

        const whiteboardActions =
          Array.isArray(
            payload.whiteboardActions
          )
            ? payload.whiteboardActions
            : []

        if (!whiteboardActions.length) {
          return
        }

        try {
          applyingRemoteWhiteboardRef.current =
            true

          for (
            const whiteboard
            of whiteboardActions
          ) {
            const action =
              String(
                whiteboard?.type || ''
              ).trim()

            if (
              action ===
              'startMathProblem'
            ) {
              await startMathProblem({
                problem:
                  whiteboard.problem,
              })
            }

            else if (
              action ===
              'writeMathStep'
            ) {
              await writeMathStep({
                text:
                  whiteboard.text,
              })
            }
          }

          setClassroomStatus(
            `Joined classroom: ${
              payload.roomId ||
              initialRoomId
            } — whiteboard restored`
          )
        }

        catch (error) {
          console.error(
            'Classroom whiteboard history replay failed:',
            error
          )

          setClassroomStatus(
            `Whiteboard history replay failed: ${
              error?.message ||
              'Unknown error'
            }`
          )
        }

        finally {
          applyingRemoteWhiteboardRef.current =
            false
        }
      }
    )

    socket.on(
      'classroom:presence',
      (payload = {}) => {
        setStudentCount(
          Number(
            payload.studentCount ||
            (payload.student
              ? 1
              : 0)
          )
        )

        setTeacherPresent(
          Boolean(
            payload.teacherConnected ??
            payload.teacher ??
            false
          )
        )
      }
    )

    socket.on(
      'classroom:whiteboard',
      async (payload = {}) => {
        if (initialViewMode !== 'student') {
          return
        }

        const whiteboard =
          payload.whiteboard || {}

        const action =
          String(whiteboard.type || '').trim()

        try {
          applyingRemoteWhiteboardRef.current =
            true

          if (action === 'startMathProblem') {
            await startMathProblem({
              problem: whiteboard.problem,
            })
          }
          else if (action === 'writeMathStep') {
            await writeMathStep({
              text: whiteboard.text,
            })
          }
        }
        catch (error) {
          console.error(
            'Classroom whiteboard sync failed:',
            error
          )

          setClassroomStatus(
            `Whiteboard sync failed: ${
              error?.message ||
              'Unknown error'
            }`
          )
        }
        finally {
          applyingRemoteWhiteboardRef.current =
            false
        }
      }
    )

    socket.on(
      'classroom:error',
      (payload = {}) => {
        setClassroomStatus(
          payload.message ||
          'Classroom connection error'
        )
      }
    )

    socket.on(
      'connect_error',
      (error) => {
        setClassroomConnected(
          false
        )

        setClassroomStatus(
          `Classroom connection failed: ${
            error?.message ||
            'Unknown error'
          }`
        )
      }
    )

    socket.on(
      'disconnect',
      () => {
        setClassroomConnected(
          false
        )

        setStudentCount(0)
        setTeacherPresent(false)

        setClassroomStatus(
          'Classroom disconnected'
        )
      }
    )

    return () => {
      try {
        socket.disconnect()
      }
      catch {}

      if (
        socketRef.current ===
        socket
      ) {
        socketRef.current =
          null
      }
    }
  }, [])


  /*
  =======================================================
  OPENAI REALTIME HELPERS
  =======================================================
  */

  function sendRealtimeEvent(
    event
  ) {
    const dataChannel =
      dataChannelRef.current

    if (
      !dataChannel ||
      dataChannel.readyState !==
        'open'
    ) {
      throw new Error(
        'OpenAI Realtime data channel is not open.'
      )
    }

    dataChannel.send(
      JSON.stringify(event)
    )
  }


  async function executeWhiteboardToolCall(
    item
  ) {
    const toolName =
      item?.name

    const callId =
      item?.call_id

    if (!toolName || !callId) {
      throw new Error(
        'OpenAI returned an incomplete whiteboard tool call.'
      )
    }

    let args = {}

    try {
      args = item.arguments
        ? JSON.parse(item.arguments)
        : {}
    }

    catch (error) {
      throw new Error(
        `Could not read arguments for ${toolName}: ${
          error?.message ||
          'Invalid JSON'
        }`
      )
    }

    let result

    try {
      if (
        toolName ===
        'startMathProblem'
      ) {
        result =
          await startMathProblem(
            args
          )
      }

      else if (
        toolName ===
        'writeMathStep'
      ) {
        result =
          await writeMathStep(
            args
          )
      }

      else {
        throw new Error(
          `Unknown whiteboard tool: ${toolName}`
        )
      }

      sendRealtimeEvent({
        type:
          'conversation.item.create',

        item: {
          type:
            'function_call_output',

          call_id:
            callId,

          output:
            JSON.stringify(
              result
            ),
        },
      })

      return result
    }

    catch (error) {
      const failure = {
        status: 'error',
        tool: toolName,
        message:
          error?.message ||
          'Whiteboard tool failed',
      }

      try {
        sendRealtimeEvent({
          type:
            'conversation.item.create',

          item: {
            type:
              'function_call_output',

            call_id:
              callId,

            output:
              JSON.stringify(
                failure
              ),
          },
        })
      }

      catch (sendError) {
        console.error(
          'Could not send whiteboard tool failure to OpenAI:',
          sendError
        )
      }

      throw error
    }
  }


  async function handleCompletedRealtimeResponse(
    message
  ) {
    const output =
      Array.isArray(
        message?.response?.output
      )
        ? message.response.output
        : []

    const functionCalls =
      output.filter(
        (item) =>
          item?.type ===
          'function_call'
      )

    if (!functionCalls.length) {
      setStatus(
        shouldListenRef.current
          ? 'Listening Ã¢â‚¬â€ speak to OpenAI'
          : 'OpenAI Realtime connected'
      )

      return
    }

    setStatus(
      functionCalls.length > 1
        ? 'Writing steps on whiteboard...'
        : 'Writing on whiteboard...'
    )

    try {
      for (
        const functionCall
        of functionCalls
      ) {
        await executeWhiteboardToolCall(
          functionCall
        )
      }

      /*
      OpenAI requires a new response after function results
      are added to the conversation. The model now sees
      that the requested mathematics is visibly on the board
      before it continues speaking.
      */
      sendRealtimeEvent({
        type:
          'response.create',
      })

      setStatus(
        'Whiteboard updated Ã¢â‚¬â€ OpenAI is continuing...'
      )
    }

    catch (error) {
      console.error(
        'OpenAI whiteboard tool failed:',
        error
      )

      setStatus(
        `Whiteboard tool failed: ${
          error?.message ||
          'Unknown error'
        }`
      )

      try {
        sendRealtimeEvent({
          type:
            'response.create',

          response: {
            instructions:
              'A whiteboard tool failed. Briefly tell the student that the whiteboard could not be updated. Do not pretend that any missing mathematics is visible.',
          },
        })
      }

      catch (sendError) {
        console.error(
          'Could not continue after whiteboard failure:',
          sendError
        )
      }
    }
  }


  function handleRealtimeEvent(
    event
  ) {
    let message

    try {
      message =
        JSON.parse(
          event.data
        )
    }

    catch {
      console.log(
        'OpenAI Realtime event:',
        event.data
      )

      return
    }

    console.log(
      'OpenAI Realtime:',
      message
    )

    if (
      message.type ===
      'session.created'
    ) {
      setStatus(
        'OpenAI Realtime session created'
      )
    }

    if (
      message.type ===
      'session.updated'
    ) {
      setStatus(
        shouldListenRef.current
          ? 'Listening Ã¢â‚¬â€ speak to OpenAI'
          : 'OpenAI Realtime connected'
      )
    }

    if (
      message.type ===
      'input_audio_buffer.speech_started'
    ) {
      setStatus(
        'Student speaking...'
      )
    }

    if (
      message.type ===
      'input_audio_buffer.speech_stopped'
    ) {
      setStatus(
        'OpenAI is responding...'
      )
    }

    if (
      message.type ===
      'response.done'
    ) {
      void handleCompletedRealtimeResponse(
        message
      )
    }

    if (
      message.type ===
      'error'
    ) {
      const errorMessage =
        message.error?.message ||
        'OpenAI Realtime returned an error.'

      console.error(
        'OpenAI Realtime error:',
        message
      )

      setStatus(
        `OpenAI error: ${errorMessage}`
      )
    }
  }


  function waitForDataChannelOpen(
    dataChannel,
    timeoutMs = 15000
  ) {
    if (
      dataChannel.readyState ===
      'open'
    ) {
      return Promise.resolve()
    }

    return new Promise(
      (resolve, reject) => {
        const timeout =
          setTimeout(
            () => {
              cleanup()

              reject(
                new Error(
                  'Timed out waiting for the OpenAI Realtime data channel to open.'
                )
              )
            },
            timeoutMs
          )

        function cleanup() {
          clearTimeout(timeout)

          dataChannel.removeEventListener(
            'open',
            handleOpen
          )

          dataChannel.removeEventListener(
            'error',
            handleError
          )
        }

        function handleOpen() {
          cleanup()
          resolve()
        }

        function handleError() {
          cleanup()

          reject(
            new Error(
              'The OpenAI Realtime data channel failed to open.'
            )
          )
        }

        dataChannel.addEventListener(
          'open',
          handleOpen
        )

        dataChannel.addEventListener(
          'error',
          handleError
        )
      }
    )
  }


  function configureRealtimeSession() {
    sendRealtimeEvent({
      type:
        'session.update',

      session: {
        type:
          'realtime',

        model:
          'gpt-realtime-2.1',

        output_modalities: [
          'audio',
        ],

        audio: {
          input: {
            turn_detection: {
              type:
                'semantic_vad',
            },
          },

          output: {
            voice:
              'marin',
          },
        },

        tools:
          whiteboardTools,

        tool_choice:
          'auto',

        instructions:
          `You are Macallin AI Math Tutor, a patient Grade 8 mathematics tutor with a natural, concise teaching voice.

LESSON ORCHESTRATION Ã¢â‚¬â€ REQUIRED:
1. Treat any uploaded or pasted lesson material as the PRIMARY curriculum for the session. Follow its order, headings, examples, guided practice, independent practice, and exit questions unless the student explicitly asks to jump elsewhere.
2. When a lesson has been supplied and the student says to begin, start from the BEGINNING of that lesson. Do not jump into a middle example or later section.
3. If the student says "restart", "start over", "go back to the beginning", or equivalent, obey immediately. Reset your lesson position to the beginning and continue from there. Do not defend or continue the previous position.
4. Do not replace the supplied lesson with a different topic, example sequence, or teaching plan unless the student explicitly requests it.
5. Teach Socratically. The student must get the first opportunity to think and answer before you perform each meaningful mathematical step.
6. Never finish an instructional explanation and then wait in unexplained silence. End each teaching turn with one short, useful question that invites the student to think, answer, predict, or choose the next step.

SOCRATIC TEACHING LOOP Ã¢â‚¬â€ REQUIRED:
7. Use this rhythm for every meaningful step: ASK Ã¢â€ â€™ WAIT Ã¢â€ â€™ STUDENT ANSWERS Ã¢â€ â€™ RESPOND Ã¢â€ â€™ WRITE Ã¢â€ â€™ EXPLAIN Ã¢â€ â€™ ASK AGAIN.
8. Before doing the next operation, ask the student a focused question such as "What should we do first?", "What operation should we use on both sides?", "What is 15 divided by 3?", or "Which part should we simplify next?"
9. After asking a question, STOP and wait for the student's answer. Do not answer your own question in the same response. Do not call writeMathStep while waiting.
10. If the student's answer is correct, acknowledge it briefly and positively, then write the resulting mathematical line with exactly one whiteboard tool call. After the line is visibly written, explain it briefly and ask the next question.
11. If the student's answer is partly correct, identify the correct part and give a small hint. Then ask the student to try again. Do not reveal the full answer unless needed.
12. If the student's answer is incorrect, do not immediately give the answer. Give one concise hint or guiding question and let the student try again. Preserve dignity and momentum.
13. If the student says "I don't know", asks for help, or remains stuck after reasonable attempts, teach the step briefly, write it on the board, and then ask a small checking question before proceeding.
14. Never make the student answer trivial housekeeping questions. Ask about meaningful reasoning, arithmetic, operations, signs, order of operations, or the next transformation.
15. Vary the questions naturally. Do not mechanically repeat "What should we do next?" after every line.
16. When the final answer is reached, ask the student to explain or verify why it is correct whenever appropriate instead of immediately ending the lesson.

WHITEBOARD PROTOCOL Ã¢â‚¬â€ REQUIRED:
17. Whenever you solve, transform, simplify, evaluate, demonstrate, or visibly reference mathematics, use the whiteboard tools. Do not merely SAY that something is on the board.
18. The browser whiteboard is the only real whiteboard. A mathematical line is NOT visible unless startMathProblem or writeMathStep has completed successfully. Never claim, imply, or pretend that you wrote something unless the corresponding tool returned success.
19. Before discussing a new worked problem, call startMathProblem with the exact original problem. Do not call writeMathStep in the same response. Wait until the original problem is visibly written.
20. After the original problem appears, briefly orient the student to it and ASK the first meaningful question. Then WAIT. Do not calculate or reveal the first step yourself.
21. After a correct student answer, make EXACTLY ONE writeMathStep call containing exactly ONE complete mathematical working line. Never make two whiteboard tool calls in the same response.
22. After a whiteboard tool succeeds, briefly explain ONLY the line already visible. Never reveal, describe, calculate aloud, or hint at a later line before the student has been asked about it.
23. For equations, show the same operation on both sides before simplifying. Example: 3x + 5 - 5 = 20 - 5 must appear before 3x = 15.
24. Use exact values first. Do not jump over arithmetic or algebra steps that a Grade 8 student needs to see.
25. The whiteboard must always lead the voice: a mathematical line must be visible before you speak about that line.
26. If a whiteboard tool fails or is unavailable, tell the student plainly that the board did not update. Do not continue as though the missing mathematics is visible.
27. If the student interrupts, stop naturally, answer the interruption, and resume from the last visible whiteboard line and the current Socratic question. Restart only when the student asks to restart.
28. Keep explanations concise, interactive, age-appropriate, and encouraging without excessive praise.

If lesson material is present, lesson order is mandatory. If mathematics is being taught, real whiteboard tool calls are mandatory. One response may contain at most ONE whiteboard tool call. Most importantly: NEVER solve the next meaningful step before the student has first been asked and given a genuine chance to answer.`,
      },
    })
  }


  /*
  =======================================================
  CONNECT OPENAI REALTIME
  =======================================================
  */

  async function connectOpenAI() {
    if (
      connected ||
      reconnecting
    ) {
      return
    }

    manualDisconnectRef.current =
      false

    shouldListenRef.current =
      false

    setReconnecting(true)
    setStatus(
      'Connecting to OpenAI Realtime...'
    )

    let peerConnection = null
    let stream = null
    let audioElement = null

    try {
      peerConnection =
        new RTCPeerConnection()

      peerConnectionRef.current =
        peerConnection

      audioElement =
        document.createElement(
          'audio'
        )

      audioElement.autoplay =
        true

      audioElement.playsInline =
        true

      audioElement.style.display =
        'none'

      document.body.appendChild(
        audioElement
      )

      remoteAudioRef.current =
        audioElement

      peerConnection.ontrack =
        (event) => {
          const remoteStream =
            event.streams?.[0]

          if (remoteStream) {
            audioElement.srcObject =
              remoteStream

            audioElement
              .play()
              .catch(
                (error) => {
                  console.warn(
                    'Remote audio autoplay was blocked:',
                    error
                  )
                }
              )
          }
        }

      peerConnection.onconnectionstatechange =
        () => {
          console.log(
            'OpenAI WebRTC connection state:',
            peerConnection
              .connectionState
          )

          if (
            peerConnection
              .connectionState ===
              'failed'
          ) {
            setStatus(
              'OpenAI WebRTC connection failed'
            )
          }

          if (
            peerConnection
              .connectionState ===
              'disconnected' &&
            !manualDisconnectRef.current
          ) {
            setStatus(
              'OpenAI WebRTC disconnected'
            )
          }
        }

      stream =
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

              channelCount:
                1,
            },
          })

      localStreamRef.current =
        stream

      for (
        const track
        of stream.getAudioTracks()
      ) {
        /*
        Connect establishes the WebRTC audio path,
        but the microphone remains muted until the
        user presses Start Microphone.
        */
        track.enabled = false

        peerConnection.addTrack(
          track,
          stream
        )
      }

      const dataChannel =
        peerConnection
          .createDataChannel(
            'oai-events'
          )

      dataChannelRef.current =
        dataChannel

      dataChannel.onmessage =
        handleRealtimeEvent

      dataChannel.onclose =
        () => {
          if (
            !manualDisconnectRef.current
          ) {
            setConnected(false)
            setListening(false)
            setStatus(
              'OpenAI Realtime data channel closed'
            )
          }
        }

      const offer =
        await peerConnection
          .createOffer()

      await peerConnection
        .setLocalDescription(
          offer
        )

      const response =
        await fetch(
          `${API_BASE}/session`,
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/sdp',
            },

            body:
              offer.sdp,
          }
        )

      const responseText =
        await response.text()

      if (!response.ok) {
        throw new Error(
          `OpenAI session server returned ${response.status}: ${responseText}`
        )
      }

      await peerConnection
        .setRemoteDescription({
          type:
            'answer',

          sdp:
            responseText,
        })

      await waitForDataChannelOpen(
        dataChannel
      )

      configureRealtimeSession()

      setConnected(true)
      setReconnecting(false)
      setStatus(
        'OpenAI Realtime connected Ã¢â‚¬â€ ready for voice test'
      )
    }

    catch (error) {
      console.error(
        'OpenAI connection failed:',
        error
      )

      if (stream) {
        for (
          const track
          of stream.getTracks()
        ) {
          track.stop()
        }
      }

      if (peerConnection) {
        try {
          peerConnection.close()
        }

        catch {}
      }

      if (audioElement) {
        try {
          audioElement.pause()
          audioElement.srcObject = null
          audioElement.remove()
        }

        catch {}
      }

      localStreamRef.current =
        null

      peerConnectionRef.current =
        null

      dataChannelRef.current =
        null

      remoteAudioRef.current =
        null

      setConnected(false)
      setListening(false)
      setReconnecting(false)

      setStatus(
        `OpenAI connection failed: ${
          error?.message ||
          'Unknown error'
        }`
      )
    }
  }


  /*
  =======================================================
  TEST VOICE
  =======================================================
  */

  async function testOpenAIVoice() {
    if (!connected) {
      setStatus(
        'Connect OpenAI first'
      )

      return
    }

    try {
      const audioElement =
        remoteAudioRef.current

      if (audioElement) {
        try {
          await audioElement.play()
        }

        catch {}
      }

      sendRealtimeEvent({
        type:
          'response.create',

        response: {
          conversation:
            'none',

          input:
            [],

          output_modalities: [
            'audio',
          ],

          instructions:
            'Say exactly this sentence aloud and nothing else: Voice test successful.',
        },
      })

      setStatus(
        'Voice test requested Ã¢â‚¬â€ listen for Ã¢â‚¬Å“Voice test successful.Ã¢â‚¬Â'
      )
    }

    catch (error) {
      console.error(
        'Voice test failed:',
        error
      )

      setStatus(
        `Voice test failed: ${
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
    if (!connected) {
      setStatus(
        'Connect OpenAI first'
      )

      return
    }

    const stream =
      localStreamRef.current

    if (!stream) {
      setStatus(
        'Microphone stream is not available Ã¢â‚¬â€ reconnect OpenAI.'
      )

      return
    }

    for (
      const track
      of stream.getAudioTracks()
    ) {
      track.enabled = true
    }

    shouldListenRef.current =
      true

    setListening(true)
    setStatus(
      'Listening Ã¢â‚¬â€ speak to OpenAI'
    )
  }


  /*
  =======================================================
  STOP MICROPHONE
  =======================================================
  */

  async function stopMicrophone() {
    const stream =
      localStreamRef.current

    if (stream) {
      for (
        const track
        of stream.getAudioTracks()
      ) {
        track.enabled = false
      }
    }

    shouldListenRef.current =
      false

    setListening(false)

    if (connected) {
      setStatus(
        'Microphone stopped Ã¢â‚¬â€ OpenAI still connected'
      )
    }
  }


  /*
  =======================================================
  DISCONNECT
  =======================================================
  */

  async function disconnectOpenAI() {
    manualDisconnectRef.current =
      true

    shouldListenRef.current =
      false

    const stream =
      localStreamRef.current

    if (stream) {
      for (
        const track
        of stream.getTracks()
      ) {
        track.stop()
      }
    }

    localStreamRef.current =
      null

    const dataChannel =
      dataChannelRef.current

    if (dataChannel) {
      try {
        dataChannel.close()
      }

      catch {}
    }

    dataChannelRef.current =
      null

    const peerConnection =
      peerConnectionRef.current

    if (peerConnection) {
      try {
        peerConnection.close()
      }

      catch {}
    }

    peerConnectionRef.current =
      null

    const audioElement =
      remoteAudioRef.current

    if (audioElement) {
      try {
        audioElement.pause()
        audioElement.srcObject = null
        audioElement.remove()
      }

      catch {}
    }

    remoteAudioRef.current =
      null

    setConnected(false)
    setListening(false)
    setReconnecting(false)
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

      const stream =
        localStreamRef.current

      if (stream) {
        for (
          const track
          of stream.getTracks()
        ) {
          track.stop()
        }
      }

      const dataChannel =
        dataChannelRef.current

      if (dataChannel) {
        try {
          dataChannel.close()
        }

        catch {}
      }

      const peerConnection =
        peerConnectionRef.current

      if (peerConnection) {
        try {
          peerConnection.close()
        }

        catch {}
      }

      const audioElement =
        remoteAudioRef.current

      if (audioElement) {
        try {
          audioElement.pause()
          audioElement.srcObject = null
          audioElement.remove()
        }

        catch {}
      }
    }
  }, [])


  /*
  =======================================================
  UI Ã¢â‚¬â€ CLASSROOM ROLE VIEW
  =======================================================
  */

  if (
    initialViewMode ===
    'student'
  ) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#f7f8fa',
        }}
      >
        <Tldraw
          onMount={handleEditorMount}
        />

        <div
          style={{
            position: 'fixed',
            top: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            minWidth: 320,
            maxWidth: 'calc(100vw - 40px)',
            boxSizing: 'border-box',
            padding: '10px 16px',
            background: 'white',
            borderRadius: 12,
            boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
            fontFamily: 'Arial',
            textAlign: 'center',
          }}
        >
          <div style={{fontWeight:800,fontSize:16}}>
            Macallin Student Classroom
          </div>

          <div style={{marginTop:4,fontSize:12,lineHeight:1.45}}>
            Room: <b>{roomId}</b>
            {' â€¢ '}
            {classroomConnected ? 'Classroom connected âœ“' : classroomStatus}
            {' â€¢ '}
            {teacherPresent ? 'Teacher present âœ“' : 'Waiting for teacher'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#f7f8fa',
      }}
    >
      <Tldraw
        onMount={handleEditorMount}
      />

      <>
            <div
              style={{
                position: 'fixed',
                top: 20,
                left: 20,
                zIndex: 1000,
                width: 330,
                maxHeight: 'calc(100vh - 40px)',
                overflowY: 'auto',
                background: 'white',
                padding: 14,
                borderRadius: 12,
                boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
                fontFamily: 'Arial',
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 17,
                  marginBottom: 4,
                }}
              >
                Macallin Teacher Console
              </div>

              <div
                style={{
                  fontSize: 11,
                  marginBottom: 12,
                  lineHeight: 1.35,
                }}
              >
                Milestone 6 Ã¢â‚¬Â¢ lesson setup and tutor supervision
              </div>

              <label style={{display:'block',fontSize:12,fontWeight:700,marginBottom:4}}>
                Student
              </label>
              <input
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Student name"
                style={{width:'100%',boxSizing:'border-box',padding:8,marginBottom:10}}
              />

              <label style={{display:'block',fontSize:12,fontWeight:700,marginBottom:4}}>
                Grade
              </label>
              <input
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                placeholder="Example: Grade 8"
                style={{width:'100%',boxSizing:'border-box',padding:8,marginBottom:10}}
              />

              <label style={{display:'block',fontSize:12,fontWeight:700,marginBottom:4}}>
                Lesson title
              </label>
              <input
                value={lessonTitle}
                onChange={(e) => setLessonTitle(e.target.value)}
                placeholder="Example: Two-Step Equations"
                style={{width:'100%',boxSizing:'border-box',padding:8,marginBottom:12}}
              />

              <label style={{display:'block',fontSize:12,fontWeight:700,marginBottom:5}}>
                Lesson file
              </label>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.txt,image/*,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null
                  setLessonFile(file)
                  setPreparedLesson(null)
                  setLessonStatus(file ? `Selected: ${file.name}` : 'No lesson prepared')
                }}
                style={{width:'100%',marginBottom:8}}
              />

              <div style={{fontSize:11,marginBottom:12,lineHeight:1.4}}>
                Accepted: JPG, PNG, WEBP, PDF, DOCX, TXT
              </div>

              <div style={{textAlign:'center',fontSize:12,margin:'7px 0',fontWeight:700}}>
                OR
              </div>

              <label style={{display:'block',fontSize:12,fontWeight:700,marginBottom:5}}>
                Paste / write lesson
              </label>
              <textarea
                value={manualLessonText}
                onChange={(e) => {
                  setManualLessonText(e.target.value)
                  setPreparedLesson(null)
                }}
                placeholder="Paste or write the mathematics lesson here..."
                rows={7}
                style={{width:'100%',boxSizing:'border-box',padding:8,resize:'vertical'}}
              />

              <button
                onClick={prepareLesson}
                disabled={preparingLesson}
                style={{width:'100%',marginTop:10,padding:'10px 12px',fontSize:14,fontWeight:700}}
              >
                {preparingLesson ? 'Preparing Lesson...' : 'Prepare Lesson'}
              </button>

              <button
                onClick={sendLessonToOpenAI}
                disabled={!preparedLesson || !connected || sendingLesson}
                style={{width:'100%',marginTop:8,padding:'10px 12px',fontSize:14,fontWeight:700}}
              >
                {sendingLesson ? 'Sending Lesson...' : 'Send Lesson to OpenAI'}
              </button>

              <div
                style={{
                  marginTop: 9,
                  padding: 8,
                  background: '#f5f5f5',
                  borderRadius: 7,
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {lessonStatus}
              </div>
            </div>

            <div
              style={{
                position: 'fixed',
                left: 20,
                bottom: 20,
                zIndex: 1000,
                width: 330,
                boxSizing: 'border-box',
                padding: '10px 12px',
                background: 'white',
                borderRadius: 12,
                boxShadow: '0 2px 12px rgba(0,0,0,0.16)',
                fontFamily: 'Arial',
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 14,
                  marginBottom: 4,
                }}
              >
                Classroom Presence
              </div>

              <div>
                Room: <b>{roomId}</b>
              </div>

              <div>
                {
                  classroomConnected
                    ? 'Server connected Ã¢Å“â€œ'
                    : classroomStatus
                }
              </div>

              <div>
                Students connected: <b>{studentCount}</b>
              </div>
            </div>

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
                boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
                fontFamily: 'Arial',
              }}
            >
              <div style={{fontWeight:700,fontSize:17,marginBottom:10}}>
                Macallin AI Tutor
              </div>

              <button
                onClick={connectOpenAI}
                disabled={connected || reconnecting}
                style={{width:'100%',padding:'10px 12px',fontSize:15}}
              >
                {reconnecting ? 'Connecting OpenAI...' : connected ? 'OpenAI Connected' : 'Connect OpenAI'}
              </button>

              <button
                onClick={startMicrophone}
                disabled={!connected || listening || reconnecting}
                style={{width:'100%',marginTop:8,padding:'10px 12px',fontSize:15}}
              >
                Start Microphone
              </button>

              <button
                onClick={stopMicrophone}
                disabled={!listening}
                style={{width:'100%',marginTop:8,padding:'10px 12px',fontSize:15}}
              >
                Stop Microphone
              </button>

              <button
                onClick={testOpenAIVoice}
                disabled={!connected || reconnecting}
                style={{width:'100%',marginTop:8,padding:'10px 12px',fontSize:15,fontWeight:700}}
              >
                Test Voice
              </button>

              <button
                onClick={testWhiteboard}
                style={{width:'100%',marginTop:8,padding:'10px 12px',fontSize:15}}
              >
                Test Whiteboard
              </button>

              <button
                onClick={disconnectOpenAI}
                disabled={!connected && !reconnecting}
                style={{width:'100%',marginTop:8,padding:'10px 12px',fontSize:15}}
              >
                Disconnect OpenAI
              </button>

              <div style={{marginTop:10,fontSize:14,lineHeight:1.4}}>
                {status}
              </div>

              {checkpointReady && (
                <div style={{marginTop:7,fontSize:12,fontWeight:600}}>
                  Ã¢Å“â€œ OpenAI Realtime session ready
                </div>
              )}

            </div>
      </>
    </div>
  )
}


export default App
