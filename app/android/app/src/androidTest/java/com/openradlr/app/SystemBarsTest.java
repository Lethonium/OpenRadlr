package com.openradlr.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.view.View;
import android.view.ViewTreeObserver;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Device checks for the start screen's real system-bar appearance. */
@RunWith(AndroidJUnit4.class)
public class SystemBarsTest {
    @Test
    public void startScreenKeepsTheStatusBarVisible() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            assertStatusBarVisible(scenario, Configuration.ORIENTATION_UNDEFINED);
        }
    }

    @Test
    public void startScreenDrawsBehindTheStatusBarWithLightSystemIcons() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                View decor = activity.getWindow().getDecorView();
                assertEquals("The island must extend under the status icons", 0, decor.getPaddingTop());
                assertFalse(WindowCompat.getInsetsController(activity.getWindow(), decor).isAppearanceLightStatusBars());
            });
        }
    }

    @Test
    public void statusBarStaysVisibleAfterReturningToTheStartScreen() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.moveToState(Lifecycle.State.CREATED);
            scenario.moveToState(Lifecycle.State.RESUMED);
            assertStatusBarVisible(scenario, Configuration.ORIENTATION_UNDEFINED);
        }
    }

    @Test
    public void startScreenKeepsItsStatusBarInLandscape() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
            try {
                assertStatusBarVisible(scenario, Configuration.ORIENTATION_LANDSCAPE);
            } finally {
                scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
            }
        }
    }

    private static void assertStatusBarVisible(ActivityScenario<MainActivity> scenario, int orientation) throws Exception {
        CountDownLatch visible = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            View decor = activity.getWindow().getDecorView();
            decor.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
                @Override
                public boolean onPreDraw() {
                    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
                    if ((orientation == Configuration.ORIENTATION_UNDEFINED
                            || activity.getResources().getConfiguration().orientation == orientation)
                        && insets != null && insets.isVisible(WindowInsetsCompat.Type.statusBars())) {
                        decor.getViewTreeObserver().removeOnPreDrawListener(this);
                        visible.countDown();
                    }
                    return true;
                }
            });
            decor.invalidate();
        });
        assertTrue("The start screen should show Android's status bar", visible.await(5, TimeUnit.SECONDS));
    }
}
