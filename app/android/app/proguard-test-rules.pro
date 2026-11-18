# Espresso brings compile-time Error Prone annotation metadata referring to this JDK-only enum.
# It is never a runtime dependency; keep the suppression confined to the instrumented test APK.
-dontwarn javax.lang.model.element.Modifier
