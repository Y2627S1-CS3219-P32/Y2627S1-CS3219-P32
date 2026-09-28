# Supplier Service

Run commands from `supplier-service/`:

```sh
npm install
npm run dev
```

`npm run dev` compiles TypeScript and starts the Express server on port 3000.
`GET /` returns a JSON status message. Restart the command after code changes.

To compile and run the built server:

```sh
npm run build
npm start
```

Run `npm run typecheck` to check TypeScript without generating output.

## Docker

From the repository root, build and start the service with its database:

```sh
docker compose up -d --build supplier-service
```

The service is available at `http://localhost:3000`. Running this command again
rebuilds the image and replaces the existing service container.

To run the service locally with npm instead, first free port 3000:

```sh
docker compose stop supplier-service
```

The Docker build compiles TypeScript in a build stage. The runtime image contains
the compiled code and production dependencies and runs as the non-root `node` user.

# AI Disclosure

AI Use Summary

Tools: GPT6

Prohibited phrases avoided: requirements elicitation; architecture/design decisions

Used for: Boilerplate generation

Logs:

- Source & mode: GPT6, Generation of boilerplate
- Prompts: in supplier-service/ ive set up some parts of the project. write some boilerplate express code to listen on 3000, check my dockerfile and fill up the instructions for running in the README
