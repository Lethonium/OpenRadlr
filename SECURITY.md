# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them
privately through GitHub: **Security → Report a vulnerability** on this
repository. Include what you found, how to reproduce it and what you think
the impact is.

We aim to acknowledge a report within a few days and to tell you what we plan
to do about it. OpenRadlr is maintained by volunteers, so please allow for that.
Once a fix is released we credit you in the changelog unless you prefer not to
be named.

## What is in scope

- The game server (WebSocket protocol, HTTP API, Strava login and upload).
- The browser client.
- The Docker and deployment files in this repository.

Out of scope: servers run by others (report those to their operators),
denial of service by sheer traffic volume, and findings that need a rider to
install malicious software on their own machine.

## Supported versions

OpenRadlr is a proof of concept. Only the latest release and `main` get fixes.
