package id.web.yatno.taskflow

// SpeechBridge — native offline voice dictation for the Tauri APK.
// The JS frontend (static/offline/voicedictate.js native impl) drives this via
// two files in the app's private filesDir:
//   speech_cmd.json  — written by the Rust `speech_cmd` command:
//                      {"cmd":"start","lang":"id-ID"} | {"cmd":"stop"}
//   speech_events    — appended here (one JSON line per event), read by the
//                      Rust `read_speech_events` command
// Events: {"type":"state","state":...} | {"type":"partial","text":...} |
//         {"type":"final","text":...} | {"type":"error","message":...} | {"type":"end"}
// The command file is deleted after consumption so a command never runs twice.

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import org.json.JSONObject
import java.io.File

object SpeechBridge {
    private const val MAX_RESTARTS = 50
    private const val POLL_MS = 250L
    private const val RESTART_MS = 300L
    private const val TAG = "SpeechBridge"
    const val REQUEST_RECORD_AUDIO = 1400

    private val handler = Handler(Looper.getMainLooper())
    private var activity: MainActivity? = null
    private var recognizer: SpeechRecognizer? = null
    private var userStopped = true
    private var restartCount = 0
    private var currentLang = "id-ID"
    private var pendingPermission = false
    private var pollerRunning = false

    fun init(act: MainActivity) {
        activity = act
        startPoller()
    }

    fun destroy() {
        pollerRunning = false
        handler.removeCallbacksAndMessages(null)
        stopListening()
    }

    fun onPermissionResult(requestCode: Int, grantResults: IntArray) {
        if (requestCode != REQUEST_RECORD_AUDIO) return
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            if (!pendingPermission) return
            pendingPermission = false
            startListening()
        } else {
            pendingPermission = false
            userStopped = true
            appendEvent(JSONObject().put("type", "error")
                .put("message", "Mikrofon tidak diizinkan. Buka pengaturan aplikasi."))
            appendEvent(JSONObject().put("type", "state").put("state", "idle"))
        }
    }

    fun stopListening() {
        userStopped = true
        pendingPermission = false
        try { recognizer?.stopListening() } catch (e: Exception) { Log.w(TAG, "stopListening failed", e) }
        try { recognizer?.destroy() } catch (e: Exception) { Log.w(TAG, "destroy recognizer failed", e) }
        recognizer = null
        appendEvent(JSONObject().put("type", "state").put("state", "idle"))
    }

    private fun startPoller() {
        pollerRunning = true
        val r = object : Runnable {
            override fun run() {
                try {
                    val f = cmdFile()
                    if (f != null && f.exists()) {
                        val raw = f.readText()
                        val cmd = JSONObject(raw)
                        f.delete()
                        when (cmd.optString("cmd")) {
                            "start" -> {
                                currentLang = cmd.optString("lang", "id-ID")
                                // Reset guard hanya saat sesi baru dimulai (bukan tiap
                                // restart internal via maybeRestart) agar cap benar-benar
                                // terakumulasi antar-restart.
                                restartCount = 0
                                startListening()
                            }
                            "stop" -> stopListening()
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "speech_cmd.json read/parse failed", e)
                } finally {
                    if (pollerRunning) handler.postDelayed(this, POLL_MS)
                }
            }
        }
        handler.post(r)
    }

    private fun startListening() {
        val act = activity ?: return
        if (act.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            pendingPermission = true
            act.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORD_AUDIO)
            appendEvent(JSONObject().put("type", "state").put("state", "waiting"))
            return
        }
        userStopped = false
        try {
            try { recognizer?.destroy() } catch (e: Exception) { Log.w(TAG, "destroy previous recognizer failed", e) }
            val sr = SpeechRecognizer.createSpeechRecognizer(act)
            recognizer = sr
            sr.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    appendEvent(JSONObject().put("type", "state").put("state", "listening"))
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {
                    appendEvent(JSONObject().put("type", "state").put("state", "paused"))
                }
                override fun onError(error: Int) {
                    val networkMsg = "Perlu internet atau paket offline: download Bahasa Indonesia di Google app → Voice → Offline speech recognition"
                    val msg = when (error) {
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                            "Mikrofon tidak diizinkan. Buka pengaturan aplikasi."
                        SpeechRecognizer.ERROR_CLIENT, SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
                            "Engine suara tidak tersedia. Pastikan Google app terpasang dan paket offline Bahasa Indonesia sudah di-download."
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> networkMsg
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "silence"
                        else -> "Engine suara error (kode $error)"
                    }
                    if (msg == "silence") {
                        appendEvent(JSONObject().put("type", "end"))
                        maybeRestart()
                    } else {
                        userStopped = true
                        appendEvent(JSONObject().put("type", "error").put("message", msg))
                        appendEvent(JSONObject().put("type", "state").put("state", "idle"))
                    }
                }
                override fun onResults(results: Bundle?) {
                    restartCount = 0
                    val txt = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull() ?: ""
                    appendEvent(JSONObject().put("type", "final").put("text", txt))
                    maybeRestart()
                }
                override fun onPartialResults(partialResults: Bundle?) {
                    restartCount = 0
                    val txt = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull() ?: ""
                    appendEvent(JSONObject().put("type", "partial").put("text", txt))
                }
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, currentLang)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            sr.startListening(intent)
        } catch (e: Exception) {
            userStopped = true
            Log.w(TAG, "startListening failed", e)
            appendEvent(JSONObject().put("type", "error")
                .put("message", "Gagal memulai dikte: ${e.message}"))
            appendEvent(JSONObject().put("type", "state").put("state", "idle"))
        }
    }

    private fun maybeRestart() {
        if (userStopped) return
        restartCount++
        if (restartCount > MAX_RESTARTS) {
            userStopped = true
            appendEvent(JSONObject().put("type", "error")
                .put("message", "Sesi terlalu lama. Silakan mulai ulang."))
            appendEvent(JSONObject().put("type", "state").put("state", "idle"))
            return
        }
        handler.postDelayed({ if (!userStopped) startListening() }, RESTART_MS)
    }

    private fun cmdFile(): File? = activity?.filesDir?.let { File(it, "speech_cmd.json") }
    private fun eventsFile(): File? = activity?.filesDir?.let { File(it, "speech_events") }

    private fun appendEvent(obj: JSONObject) {
        try {
            eventsFile()?.appendText(obj.toString() + "\n")
        } catch (e: Exception) {
            Log.w(TAG, "appendEvent failed", e)
        }
    }
}
