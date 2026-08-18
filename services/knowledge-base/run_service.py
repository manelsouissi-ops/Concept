#!/usr/bin/env python3
import os
import uvicorn
from service import build_app

uvicorn.run(build_app(), host="127.0.0.1", port=int(os.getenv("KB_PORT", "8092")), log_level="info")
