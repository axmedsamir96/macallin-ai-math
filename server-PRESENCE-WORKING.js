import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import multer from 'multer'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import OpenAI from 'openai'
import http from 'http'
import { Server } from 'socket.io'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://math.macallin.net',
]

app.use(
  cors({
    origin: allowedOrigins,
  })
)

app.use(express.json({ limit: '2mb' }))

app.use(
  express.text({
    type: 'application/sdp',
    limit: '2mb',
  })
)

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 20 * 1024 * 1024,
  },

  fileFilter(req, file, callback) {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ].includes(file.mimetype)

    if (!allowed) {
      callback(
        new Error(
          'Only PDF and DOCX lesson files are supported by the server.'
        )
      )
      return
    }

    callback(null, true)
  },
})

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'Macallin AI Math OpenAI backend',
    realtimeEndpoint: '/session',
    lessonProcessor: true,
    classroom: true,
  })
})

app.post('/session', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey) {
      res
        .status(500)
        .send(
          'OPENAI_API_KEY is missing on the server.'
        )
      return
    }

    const sdp =
      typeof req.body === 'string'
        ? req.body
        : ''

    if (!sdp) {
      res
        .status(400)
        .send(
          'Browser SDP offer is required.'
        )
      return
    }

    console.log(
      `Browser SDP received: ${sdp.length} characters`
    )

    const client = new OpenAI({
      apiKey,
    })

    const response =
      await client.realtime.calls.create({
        sdp,

        session: {
          type: 'realtime',
          model: 'gpt-realtime-2.1',
        },
      })

    const answerSdp =
      await response.text()

    if (!answerSdp) {
      throw new Error(
        'OpenAI returned an empty SDP answer.'
      )
    }

    console.log(
      `OpenAI SDP answer received: ${answerSdp.length} characters`
    )

    res
      .status(200)
      .type('application/sdp')
      .send(answerSdp)
  }
  catch (error) {
    console.error(
      'OpenAI Realtime session failed:',
      error
    )

    res
      .status(error?.status || 500)
      .send(
        error?.message ||
          'Could not create OpenAI Realtime session.'
      )
  }
})

app.post(
  '/prepare-lesson',
  upload.single('lessonFile'),
  async (req, res) => {
    try {
      const file = req.file

      if (!file) {
        res.status(400).json({
          error:
            'No lesson file was uploaded.',
        })
        return
      }

      let text = ''

      if (
        file.mimetype ===
        'application/pdf'
      ) {
        const parser =
          new PDFParse({
            data: file.buffer,
          })

        try {
          const result =
            await parser.getText()

          text =
            result?.text || ''
        }
        finally {
          await parser.destroy()
        }
      }

      else if (
        file.mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        const result =
          await mammoth.extractRawText({
            buffer: file.buffer,
          })

        text =
          result?.value || ''
      }

      text = String(text || '')
        .replace(/\u0000/g, '')
        .replace(/\r\n/g, '\n')
        .trim()

      if (!text) {
        res.status(422).json({
          error:
            'No readable lesson text was found in this file.',
        })
        return
      }

      res.json({
        ok: true,
        text,
        filename: file.originalname,
        mimeType: file.mimetype,
      })
    }
    catch (error) {
      console.error(
        'Lesson processing failed:',
        error
      )

      res.status(500).json({
        error:
          error?.message ||
          'Lesson processing failed.',
      })
    }
  }
)

/*
  ==========================================================
  MACALLIN SHARED CLASSROOM — MILESTONE 1
  Presence only.

  This does NOT modify:
  - OpenAI Realtime
  - lesson processing
  - whiteboard behavior
  - tutor behavior

  It only allows teacher and student browsers to join the
  same classroom and learn who is currently present.
  ==========================================================
*/

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
})

const classroomMembers = new Map()

function getClassroomPresence(roomId) {
  const room = classroomMembers.get(roomId)

  if (!room) {
    return {
      teacher: false,
      student: false,
    }
  }

  return {
    teacher: Boolean(room.teacher),
    student: Boolean(room.student),
  }
}

function broadcastPresence(roomId) {
  io
    .to(roomId)
    .emit(
      'classroom:presence',
      getClassroomPresence(roomId)
    )
}

io.on('connection', (socket) => {
  console.log(
    `Classroom socket connected: ${socket.id}`
  )

  socket.on(
    'classroom:join',
    ({ roomId, role } = {}) => {
      const cleanRoomId =
        String(roomId || '').trim()

      const cleanRole =
        String(role || '').trim().toLowerCase()

      if (!cleanRoomId) {
        socket.emit(
          'classroom:error',
          'A classroom ID is required.'
        )
        return
      }

      if (
        cleanRole !== 'teacher' &&
        cleanRole !== 'student'
      ) {
        socket.emit(
          'classroom:error',
          'Role must be teacher or student.'
        )
        return
      }

      if (socket.data.roomId) {
        const previousRoom =
          classroomMembers.get(
            socket.data.roomId
          )

        if (previousRoom) {
          if (
            previousRoom[
              socket.data.role
            ] === socket.id
          ) {
            previousRoom[
              socket.data.role
            ] = null
          }

          if (
            !previousRoom.teacher &&
            !previousRoom.student
          ) {
            classroomMembers.delete(
              socket.data.roomId
            )
          }
        }

        socket.leave(
          socket.data.roomId
        )

        broadcastPresence(
          socket.data.roomId
        )
      }

      if (
        !classroomMembers.has(
          cleanRoomId
        )
      ) {
        classroomMembers.set(
          cleanRoomId,
          {
            teacher: null,
            student: null,
          }
        )
      }

      const room =
        classroomMembers.get(
          cleanRoomId
        )

      room[cleanRole] =
        socket.id

      socket.data.roomId =
        cleanRoomId

      socket.data.role =
        cleanRole

      socket.join(
        cleanRoomId
      )

      console.log(
        `${cleanRole} joined classroom ${cleanRoomId}`
      )

      socket.emit(
        'classroom:joined',
        {
          roomId: cleanRoomId,
          role: cleanRole,
        }
      )

      broadcastPresence(
        cleanRoomId
      )
    }
  )

  socket.on(
    'disconnect',
    () => {
      const roomId =
        socket.data.roomId

      const role =
        socket.data.role

      if (
        !roomId ||
        !role
      ) {
        return
      }

      const room =
        classroomMembers.get(
          roomId
        )

      if (!room) {
        return
      }

      if (
        room[role] === socket.id
      ) {
        room[role] = null
      }

      if (
        !room.teacher &&
        !room.student
      ) {
        classroomMembers.delete(
          roomId
        )
      }

      console.log(
        `${role} left classroom ${roomId}`
      )

      broadcastPresence(
        roomId
      )
    }
  )
})

server.listen(PORT, () => {
  console.log(
    `Macallin OpenAI Realtime server ready at http://localhost:${PORT}`
  )

  console.log(
    'OpenAI Realtime WebRTC endpoint ready at /session'
  )

  console.log(
    'Lesson processor ready for PDF and DOCX'
  )

  console.log(
    'Macallin shared classroom presence ready'
  )
})