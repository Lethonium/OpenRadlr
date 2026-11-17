package com.openradlr.app.ride;

import com.getcapacitor.JSObject;
import java.util.function.Consumer;

/** Native radio boundary: production delegates to the installed BLE plugin. */
public interface BleTransport {
    void listen(String event, Consumer<JSObject> listener);
    void invoke(String method, JSObject options, Consumer<JSObject> ok, Consumer<String> fail);
    void close();
}
