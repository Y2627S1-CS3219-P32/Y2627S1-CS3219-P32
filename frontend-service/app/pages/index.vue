<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-29.
Scope: Link the landing-page login action to the JWT test page. Author review: Pending. -->
<template>
  <main class="flex min-h-screen items-center bg-[#f7f9fc] px-6 py-12 text-[#06427e] sm:px-12 lg:px-[5%]">
    <section class="mx-auto grid w-full max-w-[1280px] items-center gap-12 md:grid-cols-2 md:gap-16">
      <div class="order-2 md:order-1">
        <h1 class="landing-title max-w-sm text-[40px] font-bold leading-[1.12] tracking-[-1.5px] sm:text-[42px]">
          Friends of<br>Campus
        </h1>
        <p class="mt-6 text-base text-[#777] sm:text-[17px]">A place for your campus errands</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <NuxtLink
            to="/suppliers"
            class="rounded-lg bg-[#064784] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#053765] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064784]"
          >
            Sign Up
          </NuxtLink>
          <NuxtLink
            to="/login"
            class="rounded-lg border border-[#cfd5da] px-6 py-2.5 text-sm font-medium text-[#064784] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064784]"
          >
            Login
          </NuxtLink>
        </div>
      </div>

      <div class="order-1 overflow-hidden bg-white md:order-2">
        <img
          src="/images/mascot.jpg"
          alt="A campus cafe ready for your next stop"
          class="aspect-square w-full object-cover"
        >
      </div>
    </section>
  </main>
</template>
