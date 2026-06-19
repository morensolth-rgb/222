package com.fridactl

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * FloatingLogService — shows a draggable overlay window above all apps (including games).
 * Displays the last N lines of Frida script output in real-time.
 *
 * Requires SYSTEM_ALERT_WINDOW permission (Settings.canDrawOverlays).
 * On rooted devices we can grant this via pm or appops command.
 */
class FloatingLogService : Service() {

    companion object {
        const val ACTION_SHOW    = "com.fridactl.FLOAT_SHOW"
        const val ACTION_HIDE    = "com.fridactl.FLOAT_HIDE"
        const val ACTION_LOG     = "com.fridactl.FLOAT_LOG"
        const val EXTRA_LINE     = "line"
        private const val MAX_LINES = 80

        // Static log buffer so RootBridgeModule can push lines directly
        val logBuffer = ArrayDeque<String>(MAX_LINES)
        var instance: FloatingLogService? = null

        fun pushLog(line: String) {
            synchronized(logBuffer) {
                if (logBuffer.size >= MAX_LINES) logBuffer.removeFirst()
                logBuffer.addLast(line)
            }
            instance?.refreshText()
        }
    }

    private var wm: WindowManager? = null
    private var rootView: LinearLayout? = null
    private var textView: TextView? = null
    private var scrollView: ScrollView? = null
    private var visible = false

    // Drag state
    private var initX = 0; private var initY = 0
    private var initTouchX = 0f; private var initTouchY = 0f

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        buildView()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_SHOW -> showOverlay()
            ACTION_HIDE -> hideOverlay()
            ACTION_LOG  -> {
                val line = intent.getStringExtra(EXTRA_LINE) ?: return START_NOT_STICKY
                pushLog(line)
            }
        }
        return START_NOT_STICKY
    }

    private fun buildView() {
        // Container
        rootView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#E0080808"))
            setPadding(8, 8, 8, 8)
        }

        // Title bar
        val titleBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#CC00ff88"))
            setPadding(8, 4, 8, 4)
        }
        val titleTv = TextView(this).apply {
            text = "⚡ FridaCtl Log"
            setTextColor(Color.parseColor("#000000"))
            textSize = 11f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val closeBtn = TextView(this).apply {
            text = "✕"
            setTextColor(Color.parseColor("#000000"))
            textSize = 13f
            setPadding(12, 0, 4, 0)
            setOnClickListener { hideOverlay() }
        }
        val clearBtn = TextView(this).apply {
            text = "CLR"
            setTextColor(Color.parseColor("#000000"))
            textSize = 10f
            setPadding(8, 0, 8, 0)
            setOnClickListener {
                synchronized(logBuffer) { logBuffer.clear() }
                refreshText()
            }
        }
        titleBar.addView(titleTv)
        titleBar.addView(clearBtn)
        titleBar.addView(closeBtn)

        // Scroll + text
        scrollView = ScrollView(this)
        textView = TextView(this).apply {
            setTextColor(Color.parseColor("#00ff88"))
            textSize = 9.5f
            typeface = android.graphics.Typeface.MONOSPACE
            setPadding(4, 4, 4, 4)
        }
        scrollView!!.addView(textView)

        rootView!!.addView(titleBar)
        rootView!!.addView(scrollView)

        // Drag on title bar
        titleBar.setOnTouchListener { _, ev ->
            val lp = rootView!!.layoutParams as? WindowManager.LayoutParams ?: return@setOnTouchListener false
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> {
                    initX = lp.x; initY = lp.y
                    initTouchX = ev.rawX; initTouchY = ev.rawY
                }
                MotionEvent.ACTION_MOVE -> {
                    lp.x = initX + (ev.rawX - initTouchX).toInt()
                    lp.y = initY + (ev.rawY - initTouchY).toInt()
                    if (visible) wm?.updateViewLayout(rootView, lp)
                }
            }
            true
        }
    }

    private fun makeLayoutParams(): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

        return WindowManager.LayoutParams(
            520, 340,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 20; y = 120
        }
    }

    fun showOverlay() {
        if (visible) { refreshText(); return }
        try {
            wm?.addView(rootView, makeLayoutParams())
            visible = true
            refreshText()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun hideOverlay() {
        if (!visible) return
        try { wm?.removeView(rootView) } catch (_: Exception) {}
        visible = false
    }

    fun refreshText() {
        val lines = synchronized(logBuffer) { logBuffer.toList() }
        val text = lines.joinToString("\n")
        textView?.post {
            textView?.text = text
            scrollView?.post { scrollView?.fullScroll(ScrollView.FOCUS_DOWN) }
        }
    }

    override fun onDestroy() {
        hideOverlay()
        instance = null
        super.onDestroy()
    }
}
