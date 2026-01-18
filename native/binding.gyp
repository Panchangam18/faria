{
  "targets": [{
    "target_name": "window_helper",
    "sources": ["window-helper.mm"],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")"
    ],
    "libraries": ["-framework Cocoa"],
    "cflags!": ["-fno-exceptions"],
    "cflags_cc!": ["-fno-exceptions"],
    "xcode_settings": {
      "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
      "CLANG_CXX_LIBRARY": "libc++",
      "MACOSX_DEPLOYMENT_TARGET": "10.15",
      "OTHER_CPLUSPLUSFLAGS": ["-ObjC++"]
    },
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
  }]
}
